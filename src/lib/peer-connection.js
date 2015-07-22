var ee2 = require('eventemitter2').EventEmitter2;
var Q = require('q');
var SimplePeer = require('simple-peer');
var forge = require('node-forge')({disableNativeCode: true});


exports = module.exports = PeerConnection;


// In the first place, a peer connection is just an abstraction of the peer where the dstId, only needs to be
// provided at creation.
// Furthermore the PeerConnection provides some built in functionality like "pinging"
// config: {
//     dstId : hex ID of the destination peer
//     p12 : base64 encoded p12 file
//     p12password : password of the p12 file
// }
function PeerConnection(config, peer) {
    var self = this;
    self.config = config;

    self.tlsServer = null;

    self.events = new ee2({
        wildcard: true,
        newListener: false,
        maxListeners: 20
    });

    var sysmsgHandlers = {};

    var tlsKey = null;
    var tlsCert = null;

    if('p12' in self.config && self.config.p12) {
        var p12Der = forge.util.decode64(self.config.p12);
        var p12Asn1 = forge.asn1.fromDer(p12Der);
        var p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, self.config.p12password);
        tlsCert = forge.pki.certificateToPem(p12.getBags({bagType: forge.pki.oids.certBag})[forge.pki.oids.certBag][0].cert);
        var keybag = p12.getBags({bagType: forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag][0];
        tlsKey = keybag.key;
    }

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

    /* Requests a TLS encrypted connection from the other peer.
     * The other peer is the server, client certificates are not supported at the moment
     */
    self.authenticateConnection = function(){
        var deferred = Q.defer();

        self.send({sysmsg : 'initiate-tls'});

        self.tls = forge.tls.createConnection({
            disableChainVerification: true,
            server: false,
            sessionCache: {},
            cipherSuites: [forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA],
            verify: function(connection, verified, depth, certs) {
                return verified;
            },
            connected: function(connection) {
                console.log('connected');
            },
            tlsDataReady: function(connection) {
                self.send({sysmsg: 'tls-data', data: new Buffer(connection.tlsData.bytes(connection.tlsData.length())).toString("base64")});
            },
            dataReady: function(connection) {
                self.events.emit('message', {srcId: self.config.dstId, data: JSON.parse(connection.data.toString())});
            },
            /* NOTE: experimental
             heartbeatReceived: function(connection, payload) {
             // restart retransmission timer, look at payload
             clearInterval(myHeartbeatTimer);
             myHeartbeatTimer = setInterval(function() {
             connection.prepareHeartbeatRequest(forge.util.createBuffer('1234'));
             }, 5*60*1000);
             payload.getBytes();
             },*/
            closed: function(connection) {
                console.log('disconnected');
            },
            error: function(connection, error) {
                console.log('uh oh', error);
            }
        });

        self.tls.handshake();

        return deferred.promise;
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
        }  else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'initiate-tls') {
            if (!tlsCert || !tlsKey) {
                self.send({sysmsg: 'abort-tls'});
                return;
            }

            self.tls = forge.tls.createConnection({
                disableChainVerification: true,
                server: true,
                sessionCache: {},
                cipherSuites: [forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA],
                verifyClient: false,
                verify: function(connection, verified, depth, certs) {
                    return true;
                },
                connected: function(connection) {
                    console.log('connected');
                },
                getCertificate: function(connection, hint) {
                    return tlsCert;
                },
                getPrivateKey: function(connection, cert) {
                    return tlsKey;
                },
                tlsDataReady: function(connection) {
                    self.send({sysmsg: 'tls-data', data: new Buffer(connection.tlsData.bytes(connection.tlsData.length())).toString("base64")});
                },
                dataReady: function(connection) {
                    self.events.emit('message', {srcId: self.config.dstId, data: JSON.parse(connection.data.toString())});
                },
                /* NOTE: experimental
                 heartbeatReceived: function(connection, payload) {
                 // restart retransmission timer, look at payload
                 clearInterval(myHeartbeatTimer);
                 myHeartbeatTimer = setInterval(function() {
                 connection.prepareHeartbeatRequest(forge.util.createBuffer('1234'));
                 }, 5*60*1000);
                 payload.getBytes();
                 },*/
                closed: function(connection) {
                    console.log('disconnected');
                },
                error: function(connection, error) {
                    console.log('uh oh', error);
                }
            });

        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'tls-data') {
            if(self.tls){
                self.tls.process(new Buffer(envelope.data.data, "base64"));
            }
        } else {
            self.events.emit('message', envelope);
        }
    }
}

