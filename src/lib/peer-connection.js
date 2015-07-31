var ee2 = require('eventemitter2').EventEmitter2;
var Q = require('q');
var SimplePeer = require('simple-peer');
var AuthenticatedPeerConnection = require('./authenticated-peer-connection.js');

if (typeof window === 'undefined') {
    forge = require('node-forge')({disableNativeCode: true});
}


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

    self.authenticatedConnection = null;

    var currentlySending = false;
    var sendQueue = [];

    var sysmsgHandlers = {};
    var currentCData = [];

    var tlsKey = null;
    var tlsCert = null;
    var tlsReady = false;

    if('p12' in self.config && self.config.p12) {
        var p12Der = forge.util.decode64(self.config.p12);
        var p12Asn1 = forge.asn1.fromDer(p12Der);
        var p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, self.config.p12password);
        tlsCert = forge.pki.certificateToPem(p12.getBags({bagType: forge.pki.oids.certBag})[forge.pki.oids.certBag][0].cert);
        var keybag = p12.getBags({bagType: forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag][0];
        tlsKey = forge.pki.privateKeyToPem(keybag.key);
    }

    self.send = function (data, forceDht) {
        var strData = JSON.stringify(data);
        //console.log("Sending: ", strData);
        var i;
        var msgArray = [];

        /*if (strData.length > 200) {
            for (i = 0; i < strData.length / 200; i++) {
                msgArray.push(strData.substr(i * 200, 200));
            }

            //var r = strData.length - 200 * Math.floor(strData.length / 200);
            //if (r > 0)
            //    msgArray.push(strData.substr(200 * Math.floor(strData.length / 200), r));
        }*/

        if (self.directChannel && self.directChannel.destroyed) {
            self.directChannel = null;
        }


        if (msgArray.length === 0) {
            var isAck = true;

            //HACK: bad hack, as buffered amount on webrtc implementation does not seem to work.
            //Acknowledge all packets, before sending next one. Can be removed, when bufferedamount is working correctly
            //Acknowledge id was left 0 by intention, as we anyhow have a reliable connection
            if('sysmsg' in data && data.sysmsg !== 'ack') {
                isAck = false;
                data.ack = 0;
            }

            if (currentlySending && !isAck) {
                sendQueue.push(data)
            } else if (self.directChannel) {
                currentlySending = !isAck;
                self.directChannel.send(JSON.stringify(data));
            } else {
                currentlySending = !isAck;
                dhtSend(data);
            }
        } else {
            for(i=0; i<msgArray.length; i++) {
                var toSend = {
                    sysmsg: 'cdata',
                    ack: 0,
                    c: i+1,
                    cs: msgArray.length,
                    data: msgArray[i]
                };


                if (currentlySending) {
                    sendQueue.push(toSend)
                } else if (self.directChannel) {
                    currentlySending = true;
                    self.directChannel.send(JSON.stringify(toSend));
                } else {
                    currentlySending = true;
                    dhtSend(toSend);
                }
            }
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

        self.pendingChannel.on('close', function(){
            console.log("Direct data channel closed");
            delete self.directChannel;
        });

        self.pendingChannel.on('error', function(err){
            console.log("Direct data channel error: ", err);
            delete self.directChannel;
        });


        return deferred.promise;
    };

    self.directDisconnect = function () {
        if (self.directChannel) {
            self.directChannel.destroy();
            delete self.directChannel;
        }
    };

    self.destroy = function(){
      self.directDisconnect();

    };

    /* Requests a TLS encrypted connection from the other peer.
     * The other peer is the server, client certificates are not supported at the moment
     */
    self.authenticateConnection = function(cbClosed, cbError){
        var deferred = Q.defer();

        tlsReady = false;
        self.send({sysmsg : 'initiate-tls'});

        self.tls = forge.tls.createConnection({
            server: false,
            sessionCache: {},
            cipherSuites: [forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA],
            verify: function(connection, verified, depth, certs) {
                if(verified !== forge.pki.certificateError.unknown_ca){
                    return verified;
                }

                self.remoteCertificate = certs[0];
                return true;
            },
            connected: function(connection) {
                tlsReady = true;
                console.log("TLS connected");
                if(self.authenticatedConnection){
                    self.authenticatedConnection.destroy();
                }
                self.authenticatedConnection = new AuthenticatedPeerConnection(self);
                deferred.resolve(self.authenticatedConnection);
            },
            tlsDataReady: function(connection) {
                var d = connection.tlsData.getBytes();
                var db64 = new Buffer(d).toString("base64");
                self.send({sysmsg: 'tls-data', data: db64});
            },
            dataReady: function(connection) {
                console.log("TLS DATA: ", connection.data.toString());
                self.events.emit('message', {srcId: self.config.dstId, data: JSON.parse(connection.data.toString())});
            },
            closed: function(connection) {
                tlsReady = false;
                cbClosed(this);
            },
            error: function(connection, error) {
                tlsReady = false;
                cbError(this, error);
            }
        });
        self.tls.handshake();
        return deferred.promise;
    };

    self.getRemoteCertificateFingerprint = function() {
        if (typeof self.remoteCertificate === 'undefined')
            return null;

        var certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(self.remoteCertificate)).getBytes();

        var fingerprint = forge.md.sha1.create();
        fingerprint.update(certDer);
        var fingerprint_str = '';
        for (pos = 0; fingerprint.digest().toHex().length > pos; pos += 2) {
            fingerprint_str += fingerprint.digest().toHex().charAt(pos) + fingerprint.digest().toHex().charAt(pos + 1);
            if ((pos + 2) < fingerprint.digest().toHex().length) {
                fingerprint_str += ':';
            }

        }

        return fingerprint_str;
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

        var writeToLog = false;
        if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'cdata'){
            writeToLog = false;
        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'ack'){
            writeToLog = false;
        }

        if(writeToLog) {
            console.log("MessageHandler: ", envelope.data);
        }

        if('ack' in envelope.data){
            self.send({sysmsg : 'ack', id: envelope.data.ack});
        }

        if('sysmsg' in envelope.data && envelope.data.sysmsg === 'ack') {
            if(sendQueue.length > 0){
                var toSend = sendQueue.shift();
                if (self.directChannel) {
                    currentlySending = true;
                    self.directChannel.send(JSON.stringify(toSend));
                } else {
                    currentlySending = true;
                    dhtSend(toSend);
                }
            } else {
                currentlySending = false;
            }
        }else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'ping') {
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
                self.pendingChannel.on('close', function(){
                    console.log("Direct data channel closed");
                });

                self.pendingChannel.on('error', function(err){
                    console.log("Direct data channel error: ", err);
                });

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

            tlsReady = false;
            self.tls = forge.tls.createConnection({
                server: true,
                sessionCache: {},
                cipherSuites: [forge.tls.CipherSuites.TLS_RSA_WITH_AES_256_CBC_SHA],
                verifyClient: false,
                verify: function(connection, verified, depth, certs) {
                    return true;
                },
                connected: function(connection) {
                    console.log("TLS connected");
                    tlsReady = true;
                    if(self.authenticatedConnection){
                        self.authenticatedConnection.destroy();
                    }
                    self.authenticatedConnection = new AuthenticatedPeerConnection(self);
                    self.events.emit('new-authenticated-connection', self.authenticatedConnection);
                },
                getCertificate: function(connection, hint) {
                    return tlsCert;
                },
                getPrivateKey: function(connection, cert) {
                    return tlsKey;
                },
                tlsDataReady: function(connection) {
                    var d = connection.tlsData.getBytes();
                    var db64 = new Buffer(d).toString("base64");
                    self.send({sysmsg: 'tls-data', data: db64});
                },
                dataReady: function(connection) {
                    self.events.emit('message', {srcId: self.config.dstId, data: JSON.parse(connection.data.toString())});
                },
                closed: function(connection) {
                    tlsReady = false;
                    console.log('TLS to %s disconnected',self.config.dstId);
                },
                error: function(connection, error) {
                    tlsReady = false;
                    console.log('Error on TLS connection to %s: %s', self.config.dstId, error);
                }
            });

        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'tls-data') {
            if(self.tls){
                self.tls.process(new Buffer(envelope.data.data, "base64"));
            } else {
                console.log("TLS NOT INITIALIZED");
            }
        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'cdata') {
            if(envelope.data.c == 1){
                currentCData = [];
            }

            currentCData.push(envelope.data.data);

            if(envelope.data.c === envelope.data.cs){
                var d = currentCData.join('');
                currentCData = [];
                messageHandler({srcId: self.config.dstId, data: JSON.parse(d)});
            }

        } else {
            self.events.emit('message', envelope);
        }
    }
}



