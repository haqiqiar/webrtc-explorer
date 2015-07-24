var Explorer = require('./../../../src/explorer.js');
var uuid = require('uuid');
var Id = require('dht-id');
var wrtc = require('wrtc');
fs = require('fs');


//var SegfaultHandler = require('segfault-handler');

//SegfaultHandler.registerHandler();


console.log('start');


var myPeerId = uuid.v4();

if(process.argv.length > 2) {
    myPeerId = process.argv[2];
}

var p12 = undefined;

try {
    var content = fs.readFileSync('/home/areiter/' + myPeerId + '.p12');
    p12 = content.toString('base64');
} catch(err){

}


var config = {
    signalingURL: 'http://localhost:9000',
    logging: true,
    createPeerConnections: true,
    fingerTableRefreshmentInterval: 10000,
    wrtc: wrtc,
    p12: p12,
    p12password: 'test'
};

var peer = new Explorer(config);


peerGlobal = peer;

peer.events.on('registered', function(data) {
    console.log('registered with Id:', data.peerId);
    peer.updateResourceProviderState(true);
});




peer.events.on('ready', function() {
    console.log('READY: ready to send messages');

    //if(myPeerId.indexOf('client') === 0){
    if(myPeerId === 'client1'){
        setTimeout(function(){

            var dhtTime;
            var directTime;
            var peerId;
            discoverRandomPeer()
                .then(function(p){peerId = Id.hash("client2"); return peerId;})
                .then(doDirectConnect)
                .then(function(){return peerId;})
                .then(doPing)
                .then(function(){return peerId;})
                .then(doAuthenticateConnection)
                .then(function(){
                    var p = peer.peerConnection(peerId);
                    console.log(p.remoteCertificate);
                });
                //.then(doSendData);
                //.then(doPing);
                //.then(function (t){dhtTime = t; return peerId;})
                //.then(doDirectConnect)
                //.then(function(c){return doPing(peerId);})
                //.then(function(t){
                //    directTime = t;

                //    console.log("DHT/Direct ping time %d/%d", dhtTime, directTime);
                //})
                //.then(function(c){return doPing(peerId);})
                //.then(function(t){
                //    directTime = t;

                //    console.log("DHT/Direct ping time %d/%d", dhtTime, directTime);
                //});
            //doPing(Id.hash("client2")).then(function(){

            //});
        }, 2000);

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

function doAuthenticateConnection(id){
    var p = peer.peerConnection(id);
    return p.authenticateConnection(function(myp){
        console.log("Disconnected");
    }, function(myp, error){
        console.log("Error: ", error);
    });
}

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

function doSendData(id){
    var data = "";
    for(var i = 0; i<50; i++)
        data += Math.random().toString(36).substr(2,10);

    var p = peer.peerConnection(id);
    p.send({data:data});
}

function doDirectConnect(id){
    var p = peer.peerConnection(id);
    return p.directConnect();
}

function discoverRandomPeer(){
    return peer.getResourcePeers().then(function(peers){
        if(peers.length == 0){
            return null;
        } else {
            if(peers[0] === myPeerId){
                console.log("MYPEERID");
                exit(0);
            }
            return peers[0];
        }
    });
}