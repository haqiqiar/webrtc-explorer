/**
 * Created by areiter on 7/27/15.
 */
var net = require('net');
var btoa = require('btoa');
var uuid = require('uuid');
var explorer = require('../src/explorer.js');
var Id = require('dht-id');
var forge = require('node-forge');
var wrtc = require('wrtc');

var port = parseInt(process.argv[2]);
console.log('Starting server at ' + process.argv[2]);

var server = net.createServer(function(socket){


    var objectStore = {};
    var clientIdToPeerConnection = {};

    socket.on("data", function(data){
        console.log("TCP-connector received: ", data.toString() );

        try {
            data.toString().split("\n\n").forEach(function(d){
                if(d == '') return;
                var msg = JSON.parse(d);
                dispatcher(msg, socket);
            });
        } catch(ex){
            console.log(ex);
        }

    });

    socket.on('error', function(e){
        console.log('Socket Error: ', e);
    });

    socket.on('close', function(e){
        Object.keys(objectStore).forEach(function(k){

            if(typeof objectStore[k].destroy === "function"){
                objectStore[k].destroy();
            }
        });
    });

    function send(data, socket){
        try {
            socket.write(JSON.stringify(data) + '\n\n');
        } catch(ex){
            console.log("Socket send error: ", ex);
        }
    }

    function dispatcher(msg, socket){
        if(msg['type'] === "configureAndConnect"){
            configureAndConnect(msg, socket);
        } else if(msg['type'] === "getPeerConnection"){
            getPeerConnection(msg, socket);
        } else if(msg['type'] === "PeerConnection_send"){
            peerConnection_send(msg, socket);
        } else if(msg['type'] === "PeerConnection_ping"){
            peerConnection_ping(msg, socket);
        } else if(msg['type'] === "PeerConnection_directConnect"){
            peerConnection_directConnect(msg, socket);
        } else if(msg['type'] === "PeerConnection_directDisconnect"){
            peerConnection_directDisconnect(msg, socket);
        } else if(msg['type'] === "PeerConnection_authenticateConnection"){
            peerConnection_authenticateConnection(msg, socket);
        } else if(msg['type'] === "PeerConnection_getRemoteCertificateFingerprint"){
            peerConnection_getRemoteCertificateFingerprint(msg, socket);
        }  else if(msg['type'] === "PeerConnection_getRemoteCertificate"){
            peerConnection_getRemoteCertificate(msg, socket);
        }  else if(msg['type'] === "updateResourceProviderState"){
            updateResourceProviderState(msg, socket);
        }
    }

    function configureAndConnect(msg, socket){

        msg.args[0].logging = true;
        msg.args[0].createPeerConnections = true;
        msg.args[0].wrtc = wrtc;

        objectStore[msg.objectId] = new explorer(msg.args[0]);
        objectStore[msg.objectId].register(msg.args[1]);


        objectStore[msg.objectId].events.on('registered', function(data) {
            console.log("Sending event 'registered' for object ", msg.objectId);
            send({
                'type': 'event',
                'objectId': msg.objectId,
                'event': 'registered',
                'data': data
            }, socket);
        });


        objectStore[msg.objectId].events.on('ready', function() {
            console.log("Sending event 'ready' for object ", msg.objectId);
            send({
                'type': 'event',
                'objectId': msg.objectId,
                'event': 'ready'
            }, socket);
        });

        objectStore[msg.objectId].events.on('message', function(envelope) {
            send({
                'type': 'event',
                'objectId': msg.objectId,
                'event': 'message',
                'data' : envelope
            }, socket);
        });

        objectStore[msg.objectId].events.on('message-non-routable', function(envelope) {
        });

        objectStore[msg.objectId].events.on('new-peerconnection', function(peerconnection){
            var peerconnectionId = uuid.v4();
            clientIdToPeerConnection[peerconnection.config.dstId] = peerconnectionId;
            objectStore[peerconnectionId] = peerconnection;
            send({
                'type': 'event',
                'objectId': msg.objectId,
                'event': 'new-peerconnection',
                'peerconnection-id': peerconnectionId
            }, socket);
            peerconnection.events.on('message', function(envelope){
                send({
                    'type': 'event',
                    'objectId': peerconnectionId,
                    'event': 'nmessage',
                    'data': envelope
                }, socket);
            });
        });
    }

    function getPeerConnection(msg, socket){
        var peerId = /*Id.hash(*/msg.args[0];/*);*/
        if(!(peerId in clientIdToPeerConnection)){
            var peerconnectionid = uuid.v4();
            objectStore[peerconnectionid] = objectStore[msg.objectId].peerConnection(peerId);
            clientIdToPeerConnection[peerId] = peerconnectionid;
        }

        send({
            'type': 'r',
            'callId': msg['callId'],
            'data': clientIdToPeerConnection[peerId]
        }, socket);
    }

    function updateResourceProviderState(msg, socket){
        objectStore[msg.objectId].updateResourceProviderState(msg.args[0]);
    }

    function peerConnection_send(msg, socket){
        objectStore[msg.objectId].send(msg.args[0], false);
    }

    function peerConnection_ping(msg, socket){
        objectStore[msg.objectId].ping("")
            .then(function(data){
                send({
                    'type': 'r',
                    'callId': msg['callId'],
                    'success' : 1
                }, socket);
            })
            .catch(function (err){
                send({
                    'type': 'r',
                    'callId': msg['callId'],
                    'success' : 0,
                    'error' : err
                }, socket);
            });
    }

    function peerConnection_directConnect(msg, socket){
        objectStore[msg.objectId].directConnect()
            .then(function(){
                send({
                    'type': 'r',
                    'callId': msg['callId'],
                    'success' : 1
                }, socket);
            })
            .catch(function (err){
                send({
                    'type': 'r',
                    'callId': msg['callId'],
                    'success' : 0,
                    'error' : err
                }, socket);
            });
    }

    function peerConnection_authenticateConnection(msg, socket){
        objectStore[msg.objectId].authenticateConnection(function(peer){
            //closed
            send({
                'type': 'event',
                'objectId': msg.objectId,
                'event': 'authenticated-connection-closed'
            }, socket);
        }, function(myp, error){
            //error
            send({
                'type': 'event',
                'objectId': msg.objectId,
                'event': 'authenticated-connection-error',
                'data' : error
            }, socket);
        })
            .then(function(){
                send({
                    'type': 'r',
                    'callId': msg['callId'],
                    'success' : 1
                }, socket);
            })
            .catch(function (err){
                send({
                    'type': 'r',
                    'callId': msg['callId'],
                    'success' : 0,
                    'error' : err
                }, socket);
            });
    }

    function peerConnection_directDisconnect(msg, socket){
        objectStore[msg.objectId].directDisconnect();
    }

    function peerConnection_getRemoteCertificateFingerprint(msg, socket){
        send({
            'type': 'r',
            'callId': msg['callId'],
            'data' : objectStore[msg.objectId].getRemoteCertificateFingerprint()
        }, socket);
    }

    function peerConnection_getRemoteCertificate(msg, socket){
        send({
            'type': 'r',
            'callId': msg['callId'],
            'data' : forge.pki.certificateToPem(objectStore[msg.objectId].remoteCertificate)
        }, socket);
    }

});


server.listen(port);






