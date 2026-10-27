import http from "http";
import { IncomingMessage, ServerResponse } from "http";

export type Next = () => void | Promise<void>;
export type Handler = ( req: AppRequest, res: AppResponse, next: Next ) => void | Promise<void>;
export type RouteEntry = | Handler | { method: string[]; url: string[] | RegExp; callbacks: Handler[]; };
export type GroupOptions = { strictUrl?: boolean; matchPathname?: boolean; catchUnhandledExceptions?: boolean; };
export class Group { middlewares: RouteEntry[] = []; options: Required<GroupOptions>;
constructor( options: GroupOptions = { strictUrl: true, matchPathname: true, catchUnhandledExceptions: false, } ) {
this.options = { strictUrl: options.strictUrl !== false, matchPathname: options.matchPathname !== false, catchUnhandledExceptions: !!options.catchUnhandledExceptions, }; }
	add(param1: Group | Handler | { middlewares: RouteEntry[] }): this {
		if (param1 && typeof param1 === "object" && Array.isArray((param1 as any).middlewares)) {
			this.middlewares.push(...(param1 as any).middlewares);
		} else if (typeof param1 === "function") {
			this.middlewares.push(param1);
		} else {
			throw new Error( "Expected type Group | function, got " + (param1 === null ? "null" : typeof param1) );
		}
		return this;
	}
	route( method: string | string[], url: string | string[] | RegExp, ...callbacks: Handler[] ): this {
		const methods = (typeof method === "string" ? [method] : method).map((m) => m.toUpperCase() );
		const urls = typeof url === "string" ? [url] : url;
		this.middlewares.push({ method: methods, url: urls as string[] | RegExp, callbacks, });
		return this;
	}
}
export class AppRequest extends IncomingMessage { parsedUrl!: URL; query: Record<string, string> = {}; cookies: Record<string, string> = {}; matches: RegExpMatchArray | null = null; body: any;
	initialize(): this { this.parsedUrl = new URL( this.url || "/", `http://${this.headers.host || "localhost"}` );
		this.query = Object.fromEntries(this.parsedUrl.searchParams);
		this.cookies = {};
		if (this.headers.cookie) {
			for (const part of this.headers.cookie.split(";")) {
				let [name, val] = part.split("=");
				if (name && name.startsWith(" ")) name = name.slice(1);
				if (name) this.cookies[name] = val;
			}
		}
		return this;
	}
}
export class AppResponse extends ServerResponse {
	status(code: number): this { this.statusCode = code;
		return this;
	}
	json(data: unknown): this { const body = JSON.stringify(data); this.setHeader("Content-Type", "application/json"); this.end(body);
		return this;
	}
	redirect(param1: number | string, param2?: string): this {
		let status = 302;
		let route = "";
		if (typeof param1 === "number") { status = param1;
			if (typeof param2 !== "string") {
				throw new Error( "Expected type 'string' for param2 if param1 is type 'number'" );
			}
			route = param2;
		} else if (typeof param1 === "string") {
			route = param1;
		} else {
			throw new Error( "Expected type 'number' (status code) or 'string' (pathname) for param1" );
		}
		this.status(status);
		this.setHeader("Location", route);
		this.end();
		return this;
	}
	assert(...args: any[]): this { const status = args[0]; const data = args[1];
		for (let i = 2; i < args.length; i++) {
			if (args[i]) continue;
			this.status(status);
			if (typeof data === "object" && data !== null) {
				this.json(data);
			} else {
				this.end(data);
			}
			throw { silent_error: true };
		}
		return this;
	}
}
export class AppServer extends Group { server: http.Server; constructor(options?: GroupOptions) { super(options);
	this.server = http.createServer( { IncomingMessage: AppRequest as any, ServerResponse: AppResponse as any, },
		(req, res) => { this.filter(req as AppRequest, res as AppResponse); }
	);
} listen(...args: any[]) {
	return this.server.listen(...args);
}
async filter(req: AppRequest, res: AppResponse): Promise<void> {
	req.initialize();
	const matches: Handler[] = [];
		for (const route of this.middlewares) {
			if (typeof route === "function") { matches.push(route);
				continue;
			}
			const reqMethod = req.method || "";
			const methodMatch = route.method[0] === "*" || route.method.includes(reqMethod);
			let urlToMatch = this.options.matchPathname === false ? req.url || "" : req.parsedUrl.pathname;
			let matchFound = false;
			if (route.url instanceof RegExp) {
				const urlMatches = urlToMatch.match(route.url);
				if (urlMatches) { req.matches = urlMatches;
					matchFound = true;
				}
			} else {
				for (let url of route.url) {
					let current = urlToMatch;
					if (!this.options.strictUrl) { current = current.toLowerCase();
						url = url.toLowerCase();
					}
					if (url === "*" || url === current) {
						matchFound = true;
						break;
					}
				}
			}
			if (methodMatch && matchFound) {
				matches.push(...route.callbacks);
			}
		}
		if (matches.length === 0) {
			if (!res.writableEnded) { res.statusCode = 404;
				res.end("Not Found");
			}
			return;
		}
		let i = -1;
		const next = async () => { i++;
			if (i >= matches.length) return;
			try {
				await matches[i](req, res, next);
			} catch (e: any) {
				if (!(e && e.silent_error)) {
					if (!this.options.catchUnhandledExceptions) {
						console.error("Unhandled exception:", e);
					} else {
						console.error("Unhandled exception caught:", e);
					}
					if (!res.writableEnded) { res.statusCode = 500;
						res.end();
					}
				}
			}
		};
		await next();
	}
}

export default { Group, AppRequest, AppResponse, AppServer };
