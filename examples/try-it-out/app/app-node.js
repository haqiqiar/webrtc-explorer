var Explorer = require('./../../../src/explorer.js');
var PeerConnection = require('./../../../src/peer-connection.js');
var uuid = require('uuid');
var Id = require('dht-id');
var wrtc = require('wrtc');

console.log('start');

var config = {
    signalingURL: 'http://localhost:9000',
    logging: true,
    createPeerConnections: true,
    wrtc: wrtc
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
        var p2 = peer.peerConnection(Id.hash("client2"));
        var doDirectConnect = true;
        setTimeout(function() {
            var tick = new Date().getTime();

            var pong = (function(d) {
                console.log("2 Ping completed %d %s", new Date().getTime() - tick, doDirectConnect);
                tick = new Date().getTime();

                    p2.directConnect().then(function () {
                        doDirectConnect = false;
                        console.log("Direct connection established");
                        tick = new Date().getTime();
                        p2.ping("blub").then(pong);
                    });

                //p2.ping().then(pong);
            });

            p2.ping("blub").then(pong);
        }, 1000);

        /*var p3 = new PeerConnection({'dstId':Id.hash("client3")}, peer);
        setTimeout(function() {
            var tick = new Date().getTime();

            var pong = (function(d){
                console.log("3 Ping completed %d", new Date().getTime() - tick);
                tick = new Date().getTime();
                //p3.ping().then(pong);
            });

            p3.ping("blub").then(pong);
        }, 1000);

        var p4 = new PeerConnection({'dstId':Id.hash("client4")}, peer);
        setTimeout(function() {
            var tick = new Date().getTime();

            var pong = (function(d){
                console.log("4 Ping completed %d", new Date().getTime() - tick);
                tick = new Date().getTime();
                //p4.ping().then(pong);
            });

            p4.ping("blub").then(pong);
        }, 1000);

        var p5 = new PeerConnection({'dstId':Id.hash("client5")}, peer);
        setTimeout(function() {
            var tick = new Date().getTime();

            var pong = (function(d){
                console.log("5 Ping completed %d", new Date().getTime() - tick);
                tick = new Date().getTime();
                //p5.ping().then(pong);
            });

            p5.ping("blub").then(pong);
        }, 1000);
        var msg = uuid.v4();

        /*for(var i=2;i<=10;i++) {
            var p = new PeerConnection({'dstId':Id.hash("client" + i.toString())}, peer);
            p.send({'destination': 'client' + i.toString(), 'msg': msg});
        }*/

    }
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

