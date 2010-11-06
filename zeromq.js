var util = require('util');
var EventEmitter = require('events').EventEmitter;
var IOWatcher = process.binding('io_watcher').IOWatcher;
var binding = exports.capi = require('./binding');
var zmq = binding.Socket;

var namemap = (function() {
  var m = {};
  m.pub  = m.publish   = m.publisher  = zmq.ZMQ_PUB;
  m.sub  = m.subscribe = m.subscriber = zmq.ZMQ_SUB;
  m.req  = m.request   = m.requester  = zmq.ZMQ_REQ;
  m.xreq = m.xrequest  = m.xrequester = zmq.ZMQ_XREQ;
  m.rep  = m.reply     = m.replier    = zmq.ZMQ_REP;
  m.xrep = m.xreply    = m.xreplier   = zmq.ZMQ_XREP;
  m.push = m.pusher    = zmq.ZMQ_PUSH;
  m.pull = m.puller    = zmq.ZMQ_PULL;
  m.pair = zmq.ZMQ_PAIR;
  return m;
})();

var context_ = null;
var defaultContext = function() {
  if (context_ !== null)
    return context_;

  var io_threads = 1;
  if (process.env.ZMQ_IO_THREADS) {
    io_threads = parseInt(process.env.ZMQ_IO_THREADS);
    if (!io_threads || io_threads < 1) {
      util.error('Invalid number in ZMQ_IO_THREADS, using 1 IO thread.');
      io_threads = 1;
    }
  }

  context_ = new binding.Context(io_threads);
  process.on('exit', function() {
    context_.close();
    context_ = null;
  });

  return context_;
};

var Socket = function(typename) {
  var typecode = typename;
  if (typeof(typecode) !== 'number') {
    typecode = namemap[typename];
    if (!namemap.hasOwnProperty(typename) || typecode === undefined)
      throw new TypeError("Unknown socket type: " + typename);
  }

  var self = this;
  self.zmq = new zmq(defaultContext(), typecode);
  self.type = typename;
  self._outgoing = [];
  self._watcher = new IOWatcher();
  self._watcher.callback = function() { self._flush(); };
  self._watcher.set(self._fd, true, false);
  self._watcher.start();
};
util.inherits(Socket, EventEmitter);

var sockProp = function(name, option) {
  Socket.prototype.__defineGetter__(name, function() {
    return this.zmq.getsockopt(option);
  });
  Socket.prototype.__defineSetter__(name, function(value) {
    return this.zmq.setsockopt(option, value);
  });
};
sockProp('_fd',               zmq.ZMQ_FD);
sockProp('_ioevents',         zmq.ZMQ_EVENTS);
sockProp('_receiveMore',      zmq.ZMQ_RCVMORE);
sockProp('_subscribe',        zmq.ZMQ_SUBSCRIBE);
sockProp('_unsubscribe',      zmq.ZMQ_UNSUBSCRIBE);
sockProp('ioThreadAffinity',  zmq.ZMQ_AFFINITY);
sockProp('backlog',           zmq.ZMQ_BACKLOG);
sockProp('highWaterMark',     zmq.ZMQ_HWM);
sockProp('identity',          zmq.ZMQ_IDENTITY);
sockProp('lingerPeriod',      zmq.ZMQ_LINGER);
sockProp('multicastLoop',     zmq.ZMQ_MCAST_LOOP);
sockProp('multicastDataRate', zmq.ZMQ_RATE);
sockProp('receiveBufferSize', zmq.ZMQ_RCVBUF);
sockProp('reconnectInterval', zmq.ZMQ_RECONNECT_IVL);
sockProp('multicastRecovery', zmq.ZMQ_RECOVERY_IVL);
sockProp('sendBufferSize',    zmq.ZMQ_SNDBUF);
sockProp('diskOffloadSize',   zmq.ZMQ_SWAP);

Socket.prototype.bind = function(addr, cb) {
  this.zmq.bind(addr, cb);
};

Socket.prototype.connect = function(addr) {
  this.zmq.connect(addr);
};

Socket.prototype.subscribe = function(filter) {
  this._subscribe = filter;
};

Socket.prototype.unsubscribe = function(filter) {
  this._unsubscribe = filter;
};

Socket.prototype.send = function() {
  var i, length = arguments.length,
      parts = new Array(length);
  for (i = 0; i < length; i++) {
    var part = arguments[i];
    if (typeof(part) === 'string')
      part = new Buffer(part, 'utf-8');
    var flags = 0;
    if (i !== length-1)
      flags |= zmq.ZMQ_SNDMORE;
    parts[i] = [part, flags];
  }
  this._outgoing = this._outgoing.concat(parts);
  this._flush();
};

Socket.prototype._flush = function() {
  try {
    while (this._ioevents & zmq.ZMQ_POLLIN) {
      var emitArgs = ['message'];
      do {
        emitArgs.push(this.zmq.recv());
      } while (this._receiveMore);
      this.emit.apply(this, emitArgs);
    }

    while (this._outgoing.length && (this._ioevents & zmq.ZMQ_POLLOUT)) {
      var sendArgs = this._outgoing.shift();
      this.zmq.send.apply(this.zmq, sendArgs);
    }

  }
  catch (e) {
    this.emit('error', e);
  }
};

Socket.prototype.close = function() {
  this._watcher.stop();
  this._watcher = undefined;
  this.zmq.close();
};

exports.createSocket = function(typename, options) {
  var sock = new Socket(typename);

  if (typeof(options) === 'object')
    for (var key in options)
      sock[key] = options[key];

  return sock;
};
