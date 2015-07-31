var ee2 = require('eventemitter2').EventEmitter2;
var Q = require('q');
var SimplePeer = require('simple-peer');
var PeerConnection = require('./peer-connection.js');

if (typeof window === 'undefined') {
    forge = require('node-forge')({disableNativeCode: true});
}


exports = module.exports = AuthenticatedPeerConnection;

function AuthenticatedPeerConnection(peerconnection) {
    var self = this;
    self.peerConnection = peerconnection;

    var currentlySending = false;
    var sendQueue = [];

    var sysmsgHandlers = {};
    var currentCData = [];
    var destroyed = false;

    self.send = function (data, forceDht) {
        var strData = JSON.stringify(data);
        console.log("AUTH Sending: ", strData);
        self.peerConnection.tls.prepare(JSON.stringify(data));
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


    self.getRemoteCertificateFingerprint = function() {
        if (typeof self.peerConnection.remoteCertificate === 'undefined')
            return null;

        var certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(self.peerConnection.remoteCertificate)).getBytes();

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

    self.destroy = function(){
        destroyed = true;
    };

    peerconnection.events.on('message', messageHandler);

    function messageHandler(envelope) {
        if(destroyed) return;
        if (envelope.srcId !== self.peerConnection.config.dstId) return;

        console.log("AUTH MessageHandler: ", envelope.data);

        if ('sysmsg' in envelope.data && envelope.data.sysmsg === 'ping') {
            self.send({'sysmsg': 'pong'});
        } else if ('sysmsg' in envelope.data && envelope.data.sysmsg in sysmsgHandlers && sysmsgHandlers[envelope.data.sysmsg].length > 0) {
            var f = sysmsgHandlers[envelope.data.sysmsg][0];
            sysmsgHandlers[envelope.data.sysmsg].shift();
            f();
        } else {
            self.events.emit('message', envelope);
        }
    }
}



