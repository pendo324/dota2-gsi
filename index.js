var express         = require('express');
var bodyParser      = require('body-parser');
var eventEmitter    = require('events').EventEmitter;

var events = new eventEmitter();
var clients = [];

function gsi_client (ip, auth) {
    this.ip = ip;
    this.auth = auth;
    this.gamestate = {};
}
gsi_client.prototype.__proto__ = eventEmitter.prototype;

function Check_client(req, res, next) {
    // Check if this IP is already talking to us
    for (var i = 0; i < clients.length; i++) {
        if (clients[i].ip == req.ip) {
            req.client = clients[i];
            return next();
        }
    }

    // Create a new client
    clients.push(new gsi_client(req.ip, req.body.auth));
    req.client = clients[clients.length - 1];
    req.client.gamestate = req.body;

    // Notify about the new client
    events.emit('newclient', clients[clients.length - 1]);

    next();
}

function Emit_all(prefix, obj, emitter) {
    Object.keys(obj).forEach(function(key) {
        // console.log("Emitting '"+prefix+key+"' - " + obj[key]);
        emitter.emit(prefix+key, obj[key]);
    });
}

function Recursive_emit(prefix, changed, body, emitter) {
    Object.keys(changed).forEach(function(key) {
        if (typeof(changed[key]) == 'object') {
            if (body[key] != null) { // safety check
                Recursive_emit(prefix+key+":", changed[key], body[key], emitter);
            }
        } else {
            // Got a key
            if (body[key] != null) {
                if (typeof body[key] == 'object') {
                    // Edge case on added:item/ability:x where added shows true at the top level
                    // and doesn't contain each of the child keys
                    Emit_all(prefix+key+":", body[key], emitter);
                } else {
                    // console.log("Emitting '"+prefix+key+"' - " + body[key]);
                    emitter.emit(prefix+key, body[key]);
                }
            }
        }
    });
}

function Process_changes(section) {
    return function(req, res, next) {
        if (req.body[section]) {
            // console.log("Starting recursive emit for '" + section + "'");
            Recursive_emit("", req.body[section], req.body, req.client);
        }
        next();
    }
}

function Update_gamestate(req, res, next) {
    req.client.gamestate = req.body;
    next();
}

function New_data(req, res) {
    req.client.emit('newdata', req.body);
    res.end();
}

function Check_auth(tokens) {
    return function(req, res, next) {
        if (tokens) {
            if (req.body.auth) {
				if(tokens.constructor === String) {
					if(check_auth_single(req.body.auth, tokens)) {
						next();
					} else {
						console.log("Dropping message from IP: " + req.ip + ", invalid auth token");
						res.end();
					}
				}
				else if(tokens.constructor === Array) {
					if(check_auth_multi(req.body.auth, tokens)) {
						next();
					} else {
						console.log("Dropping message from IP: " + req.ip + ", invalid auth token from token list");
						res.end();
					}
				}
            } else {
                // Not a valid auth, drop the message
                console.log("Dropping message from IP: " + req.ip + ", no auth tokens provided");
                res.end();
            }
        } else {
            next();
        }
    }
}

function check_auth_single(auth, tokens) {
	let keys = Object.keys(auth)
	for(var i = 0; i < keys.length; i++) {
		if(auth[keys[i]] == tokens){
			return true
		}
	}
	return false
}

function check_auth_multi(auth, tokens) {
	let keys = Object.keys(auth)
	for(var i = 0; i < keys.length; i++) {
		for(var j = 0; j < tokens.length; j++) {
			if(tokens[j] == auth[keys[i]]) {
				return true
			}
		}
	}
	return false
}
	
var d2gsi = function(options) {
    options = options || {};
    var port = options.port || 3000;
    var tokens = options.tokens || null;
	var ip = options.ip || "0.0.0.0";

    var app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended: true}));

    app.post('/',
        Check_auth(tokens),
        Check_client,
        Update_gamestate,
        Process_changes('previously'),
        Process_changes('added'),
        New_data);

    var server = app.listen(port, ip, function() {
        console.log('Dota 2 GSI listening on port ' + server.address().port);
    });

    this.events = events;
    return this;
}

module.exports = d2gsi;