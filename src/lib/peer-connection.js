var ee2 = require('eventemitter2').EventEmitter2;
var Q = require('q');


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

    self.send = function(data) {
        peer.send(config.dstId, data);
    };

    self.ping = function(data){
        var deferred = Q.defer();
        var finished = false;

        if(!("pong" in sysmsgHandlers)){
            sysmsgHandlers["pong"] = [];
        }

        sysmsgHandlers["pong"].push(function() {
            if (!finished) {
                finished = true;
                deferred.resolve(data);
            }
        });

        setTimeout(function(){
            if(!finished){
                deferred.reject(data);
            }
        }, 10000);

        self.send({'sysmsg' : 'ping'});

        return deferred.promise;
    };

    peer.events.on('message', function(envelope){
        if('sysmsg' in envelope.data && envelope.data.sysmsg === 'ping'){
            console.log("Answering ping");
            self.send({'sysmsg' : 'pong'});
        } else if('sysmsg' in envelope.data && envelope.data.sysmsg in sysmsgHandlers && sysmsgHandlers[envelope.data.sysmsg].length > 0){
            var f = sysmsgHandlers[envelope.data.sysmsg].pop();
            f();
        } else {
            self.events.emit('message', envelope);
        }
    });

}
