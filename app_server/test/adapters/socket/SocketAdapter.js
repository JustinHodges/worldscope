var rfr = require('rfr');
var Lab = require('lab');
var lab = exports.lab = Lab.script();
var Code = require('code');
var io = require('socket.io-client');
var Promise = require('bluebird');
var Iron = Promise.promisifyAll(require('iron'));

var Router = rfr('app/Router');
var TestUtils = rfr('test/TestUtils');
var Authenticator = rfr('app/policies/Authenticator');
var ServerConfig = rfr('config/ServerConfig.js');
var Service = rfr('app/services/Service');
var SocketAdapter = rfr('app/adapters/socket/SocketAdapter');

var options ={
  transports: ['websocket'],
  'force new connection': true
};

var bob = {
  username: 'Bob',
  alias: 'Bob the Builder',
  email: 'bob@bubblegum.com',
  password: 'generated',
  accessToken: 'xyzabc',
  platformType: 'facebook',
  platformId: '1238943948',
  description: 'bam bam bam'
};

lab.experiment('socket.io connection and identify', function () {
  lab.before({timeout: 10000}, function (done) {
    TestUtils.resetDatabase(done);
  });

  lab.test('missing cookie', function (done) {
    var client = io.connect('http://localhost:3000', options);

    client.once('connect', () => { 
      client.once('identify', (msg) => {
        Code.expect(msg).to.equal('ERR');
        client.disconnect();
        done();
      });

      client.emit('identify');
    });
  });

  lab.test('invalid cookie', function (done) {
    var client = io.connect('http://localhost:3000', options);

    client.once('connect', () => { 
      client.once('identify', (msg) => {
        Code.expect(msg).to.equal('ERR');
        client.disconnect();
        done();
      });

      client.emit('identify', 'abcdef');
    });
  });

  lab.test('valid cookie invalid credentials', function (done) {
    var client = io.connect('http://localhost:3000', options);
    var account = {userId: 1, username: 'bob', password: 'abc',
                   scope: Authenticator.SCOPE.USER};
    Iron.sealAsync(account, ServerConfig.cookiePassword, Iron.defaults)
    .then((sealed) => {
      client.once('connect', () => { 
        client.once('identify', (msg) => {
          Code.expect(msg).to.equal('ERR');
          client.disconnect();
          done();
        });

        client.emit('identify', sealed);
      });
    });
  });

  lab.test('valid cookie valid credentials', (done) => {
    Service.createNewUser(bob).then((user) => {
      var account = TestUtils.copyObj(Authenticator.generateUserToken(user),
                                      ['userId', 'username', 'password']);
      account.scope = Authenticator.SCOPE.USER;
      return Iron.sealAsync(account, ServerConfig.cookiePassword, Iron.defaults)
      .then((sealed) => {
        var client = io.connect('http://localhost:3000', options);

        client.once('connect', () => {
          client.once('identify', (msg) => {
            Code.expect(msg).to.equal('OK');
            client.disconnect();
            done();
          });

          client.emit('identify', sealed);
        });
      });
    });
  });
});

lab.experiment('socket.io disconnect', function () {
  lab.before({timeout: 10000}, function (done) {
    TestUtils.resetDatabase(done);
  });
  lab.test('Disconnect should remove client', {timeout: 5000}, (done) => {
    Service.createNewUser(bob).then((user) => {
      var account = TestUtils.copyObj(Authenticator.generateUserToken(user),
                                      ['userId', 'username', 'password']);
      account.scope = Authenticator.SCOPE.USER;
      return Iron.sealAsync(account, ServerConfig.cookiePassword, Iron.defaults)
      .then((sealed) => {
        var client = io.connect('http://localhost:3000', options);

        client.once('connect', () => {
          client.once('identify', (msg) => {
            Code.expect(msg).to.equal('OK');
            client.disconnect();
          });
          client.emit('identify', sealed);
        });

        setTimeout(() => {
          var socketUser = SocketAdapter.roomsManager.getUser(user.userId);
          Code.expect(socketUser).to.be.undefined();
          done();
        }, 1000);
      });
    });
  });
});

lab.experiment('Room join and leave', function () {
  lab.beforeEach({timeout: 10000}, function (done) {
    TestUtils.resetDatabase(done);
  });

  function isUserInRoom(userId, roomName) {
    var userSockets = SocketAdapter.roomsManager.getUser(userId);
    var room = SocketAdapter.roomsManager.__getRoom(roomName);
    for (var socketId in userSockets) {
      var roomHasClient = room.getClient(socketId);
      var clientHasRoom = userSockets[socketId].getRooms()[roomName];

      if (roomHasClient && clientHasRoom) {
        return true;
      }
      if (roomHasClient || clientHasRoom) {
        throw new Error('Room and client states are not consistent');
      }
    }
    return false;
  }

  lab.test('Client is in room after join', (done) => {
    Service.createNewUser(bob).then((user) => {
      var account = TestUtils.copyObj(Authenticator.generateUserToken(user),
                                      ['userId', 'username', 'password']);
      account.scope = Authenticator.SCOPE.USER;
      return Iron.sealAsync(account, ServerConfig.cookiePassword, Iron.defaults)
      .then((sealed) => {
        SocketAdapter.createNewRoom('abc');
        var client = io.connect('http://localhost:3000', options);

        client.once('connect', () => {
          client.once('identify', (msg) => {
            Code.expect(msg).to.equal('OK');
            client.emit('join', 'abc');
          });
          client.once('join', (msg) => {
            Code.expect(msg.message).to.equal('OK');
            Code.expect(msg.room).to.equal('abc');
            Code.expect(msg.userId).to.equal('me');
            Code.expect(isUserInRoom(account.userId, 'abc')).to.be.true();
            done();
          });
          client.emit('identify', sealed);
        });
      });
    });
  });

  lab.test('Join non-existent room', {timeout: 5000}, (done) => {
    Service.createNewUser(bob).then((user) => {
      var account = TestUtils.copyObj(Authenticator.generateUserToken(user),
                                      ['userId', 'username', 'password']);
      account.scope = Authenticator.SCOPE.USER;
      return Iron.sealAsync(account, ServerConfig.cookiePassword, Iron.defaults)
      .then((sealed) => {
        var client = io.connect('http://localhost:3000', options);

        client.once('connect', () => {
          client.once('identify', (msg) => {
            Code.expect(msg).to.equal('OK');
            client.emit('join', 'xyz');
          });
        });
        client.emit('identify', sealed);

        setTimeout(() => {
          Code.expect(isUserInRoom(account.userId, 'abc')).to.be.false();
          done();
        }, 1000);
      });
    });
  });

  lab.test('Client is not in room after leave', (done) => {
    Service.createNewUser(bob).then((user) => {
      var account = TestUtils.copyObj(Authenticator.generateUserToken(user),
                                      ['userId', 'username', 'password']);
      account.scope = Authenticator.SCOPE.USER;
      return Iron.sealAsync(account, ServerConfig.cookiePassword, Iron.defaults)
      .then((sealed) => {
        SocketAdapter.createNewRoom('abc');
        var client = io.connect('http://localhost:3000', options);

        client.once('connect', () => {
          client.once('identify', (msg) => {
            Code.expect(msg).to.equal('OK');
            client.emit('join', 'abc');
          });
          client.once('join', (msg) => {
            client.emit('leave', 'abc');
          });
          client.once('leave', (msg) => {
            Code.expect(msg.message).to.equal('OK');
            Code.expect(msg.room).to.equal('abc');
            Code.expect(msg.userId).to.equal('me');
            Code.expect(isUserInRoom(account.userId, 'abc')).to.be.false();
            done();
          });
          client.emit('identify', sealed);
        });
      });
    });
  });
});
