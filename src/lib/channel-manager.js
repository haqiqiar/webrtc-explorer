var SimplePeer = require('simple-peer');
var wrtc = require('wrtc');

exports = module.exports = ChannelManager;


var _pendingConnections = {};

function ChannelManager(peerId, ioc, router) {
    var self = this;

    /// establish a connection to another peer

    self.connect = function(dstId, cb) {
        console.log('connect to: ', dstId);

        var intentId = (~~(Math.random() * 1e9))
                        .toString(36) + Date.now();

        var channel = new SimplePeer({initiator: true, wrtc: wrtc});

        channel.on('signal', function (signal) {
            console.log('sendOffer %s', JSON.stringify(signal));
            ioc.emit('s-send-offer', {offer: {
                intentId: intentId,
                srcId: peerId.toHex(),
                dstId: dstId,
                signal: signal
            }});
        });

        var listener = ioc.on('c-offer-accepted', offerAccepted);

        function offerAccepted(data) {
            if(data.offer.intentId !== intentId) { 
//                log('OK: not right intentId: ',
//                        data.offer.intentId, intentId);
                return; 
            }
            console.log('offerAccepted: %s', JSON.stringify(data.offer.signal));

            channel.signal(data.offer.signal);

            channel.on('connect', function() {
                delete _pendingConnections[data.offer.intentId];
                console.log('channel ready to send');
                channel.on('message', function(){
                    console.log('DEBUG: this channel should be '+
                        'only used to send and not to receive');
                });
                cb(null, channel);
            });
        }
    };

    /// accept offers from peers that want to connect

    ioc.on('c-accept-offer', function(data) {
        console.log('acceptOffer: %s', JSON.stringify(data));

        var channel;
        if(!(data.offer.intentId in _pendingConnections)){
            channel = new SimplePeer({wrtc: wrtc});
            channel.on('connect', function() {
                console.log('channel ready to listen');
                channel.on('message', router);
            });

            channel.on('signal', function (signal){
                // log('sending back my signal data');
                data.offer.signal = signal;
                ioc.emit('s-offer-accepted', data);
            });

            _pendingConnections[data.offer.intentId] = channel;
        } else {
            channel = _pendingConnections[data.offer.intentId];
        }

        channel.signal(data.offer.signal);
    });

}
