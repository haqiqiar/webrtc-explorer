var ee2 = require('eventemitter2').EventEmitter2;
var io = require('socket.io-client');
var Id = require('dht-id');
var FingerTable = require('./finger-table.js');
var ChannelManager = require('./channel-manager.js');
var PeerConnection = require('./peer-connection.js');

if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    localStorage = new LocalStorage('./scratch');
}

exports = module.exports = Peer;

// config: {
//     signalingURL: <IP or Host of webrtc-ring-signaling-server>
//     logging: defaults to false,
//     createPeerConnections: defaults to false
// }
function Peer(config) {
    localStorage.debug = config.logging || false;
    var self = this;

    self.events = new ee2({
        wildcard: true,
        newListener: false,
        maxListeners: 20 
    });

    var peerconnections = {};

    var ioc = io(config.signalingURL + '/');

    ioc.once('connect', connected);
    ioc.on('c-finger-update', function(data) {
        if (!self.fingerTable) {
            console.log('DEBUG: got a finger-update before finger table was ready');
        }

        self.fingerTable.fingerUpdate(data);
    });

    ioc.on('c-predecessor', function(data) {
        if (!self.fingerTable) {
            console.log('DEBUG: got a predecessor before finger table was ready');
        }
        self.fingerTable.predecessorUpdate(data);
    });


    function connected() {
        console.log('socket.io connection established');
    }

    /// module api

    self.register = function(peerId) {
        ioc.once('c-registered', registered);

        function registered(data) {
            self.peerId = new Id(data.peerId);
            self.channelManager = new ChannelManager(self.peerId,
                                                     ioc,
                                                     router);
            self.fingerTable = new FingerTable(self.peerId, 
                                               self.events,
                                               self.channelManager);
            var readyEventSent = false;
            self.fingerTable.events.on('fingerUpdate', function(data){
                if(readyEventSent) return;
                //Send the ready event for the first 'fingerUpdate' event
                readyEventSent = true;
                self.events.emit('ready', {});
            });
            self.events.emit('registered', {peerId: data.peerId});
        }

        ioc.emit('s-register', {'id' : peerId});
    };

    self.updateResourceProviderState = function(enable){
      ioc.emit('update-resource-state', {'provideResources' : enable});
    };

    self.send = function(dstId, data) {
        var envelope = {
            dstId: dstId,
            srcId: self.peerId.toHex(),
            data: data
        };
        
        router(envelope);
    };

    /// message router

    function router(envelope) {
        var nextHop = self.fingerTable.bestCandidate(envelope.dstId);
        console.log('nextHop:', nextHop, envelope);
        if (nextHop === self.peerId.toHex() && envelope.dstId === self.peerId.toHex()) {
            self.events.emit('message', envelope);
            if(config.createPeerConnections){
                if(!(envelope.srcId in peerconnections)){
                    peerconnections[envelope.srcId] = new PeerConnection({dstId: envelope.srcId}, self);
                    self.events.emit('new-peerconnection', peerconnections[envelope.srcId]);
                }
                peerconnections[envelope.srcId].events.emit('message', envelope);
            }
        } else if (nextHop === self.peerId.toHex()){
            return self.events.emit('message-non-routable', envelope);
        } else {
            self.fingerTable.channelTo(nextHop).send(envelope);
        }
    }

}
