import { app } from "electron";
import { Group } from "../miniHttp";
import { join, normalize, extname } from "path";
import { createReadStream, existsSync, statSync } from "fs";
import asset from "./asset";
import char from "./char";
import movie from "./movie";
import settings from "./settings";
import theme from "./theme";
import tts from "./tts";
import watermark from "./watermark";
import waveform from "./waveform";

const IS_DEV = app.commandLine.getSwitchValue("dev").length > 0;
const group = new Group();

group.add(asset);
group.add(char);
group.add(movie);
group.add(theme);
group.add(settings);
group.add(tts);
group.add(watermark);
group.add(waveform);

group.route("POST", "/goapi/getCCPreMadeCharacters", (_, r) => { r.end(); });
group.route("POST", "/api_v2/team/members", (_, r) => { r.json({ status: "ok", data: [] }); });
group.route("GET", "/goapi/getAssetTags", (_, r) => { r.json([]); });
group.route("POST", "/goapi/getUserFontList/", (_, r) => { r.json({ status: "ok" }); });
group.route("POST", "/api_v2/studio_preference/get", (_, r) => { r.json({ status: "ok", data: [] }); });
group.route("POST", "/api_v2/text_component/get_list", (_, r) => { r.json({ status: "ok", data: [] }); });
group.route("POST", "/api_v2/text_component/add", (_, r) => { r.json({ status: "ok", data: [] }); });
group.route("OPTIONS", "*", (req, res) => { const origin = req.headers.origin || "";
	if (
		!origin.includes("127.0.0.1") &&
		!(origin.includes("localhost") && !origin.includes("."))
	) {
		return res.status(400).end();
	}
	res.writeHead(200, { "access-control-allow-headers": "*", "access-control-allow-origin": "*", }).end();
});
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json",
};
function safePath(root: string, urlPath: string): string | null {
	const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
	const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
	const full = normalize(join(root, rel));
	if (!full.startsWith(normalize(root))) return null;
	return full;
}
function serveRenderer(req: any, res: any) {
	const root = join(__dirname, "renderer");
	let filePath = safePath(root, req.url || "/");
	if (!filePath) {
		res.statusCode = 403;
		return res.end();
	}
	if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
		filePath = join(root, "index.html");
		if (!existsSync(filePath)) {
			res.statusCode = 404;
			return res.end("Not found");
		}
	}
	const mime = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
	res.writeHead(200, {
		"Content-Type": mime,
		"Cache-Control": "no-store",
	});
	createReadStream(filePath).pipe(res);
}
if (!IS_DEV) {
	group.route("*", "*", async (req, res) => {
		if (res.writableEnded) return;
		serveRenderer(req, res);
	});
}

export default group;
