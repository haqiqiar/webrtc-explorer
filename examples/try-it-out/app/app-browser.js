var Explorer = require('./../../../src/explorer.js');
var uuid = require('uuid');
var Id = require('dht-id');
var CA = require('../../../src/lib/CA.js');


console.log('start');

var config = {
    signalingURL: 'http://localhost:9000',
    logging: true,
    createPeerConnections: true,
    p12: new CA().createSelfSignedCertificate("POWER: offloadme", "AT", "My Location", "IAIK", ""),
    p12password: ''
};


var idBase = "client";

var peer = new Explorer(config);
var myPeerId = "browser"; //uuid.v4();

peerGlobal = peer;

peer.events.on('registered', function(data) {
    console.log('registered with Id:', data.peerId);
    peer.updateResourceProviderState(true);
});

peer.events.on('ready', function() {
    console.log('READY: ready to send messages');

    setTimeout(function(){

        var dhtTime;
        var directTime;
        var peerId;
        discoverRandomPeer()
            .then(function(p){peerId = p; return p;})
            .then(doPing)
            .then(function (t){dhtTime = t; return peerId;})
            .then(doDirectConnect)
            .then(function(c){return doPing(peerId);})
            .then(function(t){
                directTime = t;
                console.log("DHT/Direct ping time %d/%d", dhtTime, directTime);
                return peerId;
            }).then(doAuthenticateConnection)
            .then(function(){
                var p = peer.peerConnection(peerId);
                console.log(forge.pki.certificateToPem(p.remoteCertificate));
                console.log(p.getRemoteCertificateFingerprint());
            });
        //doPing(Id.hash("client2")).then(function(){

        //});
    }, 2000);
});

peer.events.on('message', function(envelope) {
    //console.log('MESSAGE: %s', JSON.stringify(envelope.data));
});

peer.events.on('message-non-routable', function(envelope) {
    //console.log('NON-ROUTABLE MESSAGE to %s', envelope.dstId);
});

peer.events.on('new-peerconnection', function(peerconnection){
    console.log("NEW PEER CONNECTION FROM %s", peerconnection.config.dstId);
   peerconnection.events.on('message', function(envelope){
      //console.log("PEERCONNECTION: %s", JSON.stringify(envelope));
   });
});

peer.register(myPeerId);

function doPing(id){
    var p = peer.peerConnection(id);
    var tick = new Date().getTime();

    var pong = (function(d) {
        var time = new Date().getTime() - tick;
        console.log("Ping completed %d", time);
        return time;
    });
    return p.ping("").then(pong);
}

function doDirectConnect(id){
    console.log("Building a direct connection");
    var p = peer.peerConnection(id);
    return p.directConnect();
}

function discoverRandomPeer(){
    return peer.getResourcePeers().then(function(peers){
        return Id.hash("client2");
        /*if(peers.length == 0){
            return null;
        } else {
            return peers[0];
        }*/
    });
}

function doAuthenticateConnection(id){
    var p = peer.peerConnection(id);
    return p.authenticateConnection(function(myp){
        console.log("Disconnected");
    }, function(myp, error){
        console.log("Error: ", error);
    });
}