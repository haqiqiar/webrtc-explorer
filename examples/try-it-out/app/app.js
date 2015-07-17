var Explorer = require('./../../../src/explorer.js');
var PeerConnection = require('./../../../src/peer-connection.js');
var uuid = require('uuid');
var Id = require('dht-id');

console.log('start');

var config = {
    signalingURL: 'http://localhost:9000',
    logging: true,
    createPeerConnections: true
};

var idBase = "client";

var peer = new Explorer(config);
var myPeerId = uuid.v4();

if(process.argv.length > 2) {
    myPeerId = process.argv[2];
}

peerGlobal = peer;

peer.events.on('registered', function(data) {
    console.log('registered with Id:', data.peerId);
    peer.updateResourceProviderState(true);
});

peer.events.on('ready', function() {
    console.log('READY: ready to send messages');

    if(myPeerId === 'client1'){
        var msg = uuid.v4();

        for(var i=2;i<=10;i++) {
            var p = new PeerConnection({'dstId':Id.hash("client" + i.toString())}, peer);
            p.send({'destination': 'client' + i.toString(), 'msg': msg});
        }
    }
});

peer.events.on('message', function(envelope) {
    console.log('MESSAGE: %s', JSON.stringify(envelope.data));
});

peer.events.on('message-non-routable', function(envelope) {
    console.log('NON-ROUTABLE MESSAGE to %s', envelope.dstId);
});

peer.events.on('new-peerconnection', function(peerconnection){
    console.log("NEW PEER CONNECTION FROM %s", peerconnection.config.dstId);
   peerconnection.events.on('message', function(envelope){
      console.log("PEERCONNECTION: %s", JSON.stringify(envelope));
   });
});

peer.register(myPeerId);

