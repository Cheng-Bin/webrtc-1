var express = require('express');

var forceSSL = require('express-force-ssl');
var fs = require('fs');
var http = require('http');
var https = require('https');
var ssl_options = {
  key: fs.readFileSync('./etc/nginx/ssl/nginx.key'),
  cert: fs.readFileSync('./etc/nginx/ssl/nginx.crt'),
  ca: fs.readFileSync('./etc/nginx/ssl/nginx.crt')
};

var app = express()
var cors = require('cors');
var bodyParser = require("body-parser");


var secureServer = https.createServer(ssl_options, app);

var opts = {
	port: 8081,
	maxUploadSize: "20971520"
};

app.use(express.static(__dirname + '/html'));
app.use(bodyParser.urlencoded({ limit: '20MB', extended: true }));
app.use(cors());

app.use(forceSSL);

app.post('/upload', function(req, res) {
	res.setHeader('Content-Type', 'application/json');
	res.send(JSON.stringify({}));
	res.end();
});

secureServer.listen(443);
app.listen(opts.port);
