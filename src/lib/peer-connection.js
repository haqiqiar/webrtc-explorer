var ee2 = require('eventemitter2').EventEmitter2;


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

    self.send = function(data) {
        peer.send(config.dstId, data);
    };

    peer.events.on('message', function(envelope){
        if('sysmsg' in envelope.data && envelope.data.sysmsg === 'ping'){
            self.send({'sysmsg' : 'pong'});
        } else {
            self.events.emit('message', envelope);
        }
    });

}
