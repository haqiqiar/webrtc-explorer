var ee2 = require('eventemitter2').EventEmitter2;
var Q = require('q');
var SimplePeer = require('simple-peer');


exports = module.exports = PeerConnection;


// In the first place, a peer connection is just an abstraction of the peer where the dstId, only needs to be
// provided at creation.
// Furthermore the PeerConnection provides some built in functionality like "pinging"
// config: {
//     dstId : hex ID of the destination peer
// }
function PeerConnection(config, peer) {
    var self = this;
    self.config = config;

    self.events = new ee2({
        wildcard: true,
        newListener: false,
        maxListeners: 20
    });

    var sysmsgHandlers = {};

    self.send = function (data) {
        if (self.directChannel && self.directChannel.destroyed) {
            self.directChannel = null;
        }

        if (self.directChannel) {
            self.directChannel.send(JSON.stringify(data));
        } else {
            dhtSend(data);
        }
    };


    self.ping = function (data) {
        var deferred = Q.defer();
        var finished = false;

        if (!("pong" in sysmsgHandlers)) {
            sysmsgHandlers["pong"] = [];
        }

        sysmsgHandlers["pong"].push(function () {
            if (!finished) {
                finished = true;
                deferred.resolve(data);
            }
        });

        setTimeout(function () {
            if (!finished) {
                deferred.reject(data);
            }
        }, 10000);

        self.send({'sysmsg': 'ping'});

        return deferred.promise;
    };

    //Tries to build a direct connection with the corresponding endpoint
    self.directConnect = function () {
        var deferred = Q.defer();

        if(typeof(self.directChannel) !== 'undefined' && !self.directChannel.destroyed){
            deferred.resolve(self.directChannel);
            return deferred.promise;
        }

        delete self.directChannel;

        self.pendingChannel = new SimplePeer({initiator: true, wrtc: self.config.wrtc});

        self.pendingChannel.on('signal', function (signal) {
            console.log('direct offer: ', JSON.stringify(signal));
            dhtSend({sysmsg: 'offer', data: signal});
        });

        self.pendingChannel.on('connect', function () {
            self.directChannel = self.pendingChannel;
            delete self.pendingChannel;
            deferred.resolve();
        });

        self.pendingChannel.on('data', directChannel_onData);

        return deferred.promise;
    };

    self.directDisconnect = function () {
        if (self.directChannel) {
            self.directChannel.destroy();
            delete self.directChannel;
        }
    };

    peer.events.on('message', messageHandler);


    function dhtSend(data) {
        peer.send(config.dstId, data);
    }


    function directChannel_onData(data) {
        console.log("Direct channel data: %s", JSON.stringify(data));
        messageHandler({srcId: self.config.dstId, data: data});
    }

    function messageHandler(envelope) {
        if (envelope.srcId !== self.config.dstId) return;

        if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'ping') {
            self.send({'sysmsg': 'pong'});
        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'offer') {
            if (!self.pendingChannel) {
                self.pendingChannel = new SimplePeer({initiator: false, wrtc: self.config.wrtc});

                self.pendingChannel.on('connect', function () {
                    console.log('direct channel ready');
                    self.directChannel = self.pendingChannel;
                    delete self.pendingChannel;
                });

                self.pendingChannel.on('signal', function (signal) {
                    dhtSend({sysmsg: 'answer', data: signal});
                });

                self.pendingChannel.on('data', directChannel_onData);
            }
            //console.log("SETTING OFFER");
            self.pendingChannel.signal(envelope.data.data);

        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'answer') {
            //console.log("SETTING ANSWER");
            self.pendingChannel.signal(envelope.data.data);

        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg in sysmsgHandlers && sysmsgHandlers[envelope.data.sysmsg].length > 0) {
            var f = sysmsgHandlers[envelope.data.sysmsg][0];
            sysmsgHandlers[envelope.data.sysmsg].shift();
            f();
        } else {
            self.events.emit('message', envelope);
        }
    }
}

