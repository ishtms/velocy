const http = require("http");

class TrieNode {
    constructor() {
        this.children = Object.create(null);
        this.handler = Object.create(null);
        this.param = null;
    }
}

class Router {
    constructor() {
        this.root = new TrieNode();
    }

    get(path, handler) {
        this.addRoute("GET", path, handler);
    }

    post(path, handler) {
        this.addRoute("POST", path, handler);
    }

    addRoute(method, path, handler) {
        let node = this.root;

        let start = 1,
            end = 1,
            len = path.length;
        for (; end <= len; ++end) {
            if (end === len || path[end] === "/") {
                let segment = path.substring(start, end);

                let child;
                if (segment[0] === ":") {
                    if (!node.param) node.param = new TrieNode();
                    child = node.param;
                } else {
                    child = node.children[segment] || (node.children[segment] = new TrieNode());
                }
                node = child;
                start = end + 1;
            }
        }

        node.handler[method] = handler;
    }

    findRoute(method, path) {
        let node = this.root;
        let params = Object.create(null);

        let start = 1,
            end = 1,
            len = path.length;
        for (; end <= len; ++end) {
            if (end === len || path[end] === "/") {
                let segment = path.substring(start, end);
                let child = node.children[segment];

                if (!child && node.param) {
                    child = node.param;
                    params[node.param] = segment;
                }
                if (!child) return null;
                node = child;
                start = end + 1;
            }
        }

        if (!node.handler[method]) return null;

        return { handler: node.handler[method], params };
    }

    route(req, res) {
        const url = req.url;
        const queryStart = url.indexOf("?");
        const path = queryStart === -1 ? url : url.substring(0, queryStart);
        const routeData = this.findRoute(req.method, path);

        if (!routeData) {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        req.params = routeData.params;
        req.query = new URLSearchParams(queryStart === -1 ? "" : url.substring(queryStart)).entries();
        routeData.handler(req, res);
    }
}

function createServer(router) {
    return http.createServer((req, res) => {
        router.route(req, res);
    });
}

module.exports = {
    Router,
    createServer,
};
