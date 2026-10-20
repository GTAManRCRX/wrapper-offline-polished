import fs from "fs";
import httpz from "@octanuary/httpz";
import Database from "../../storage/database";
import MovieModel, { Movie } from "../models/movie";
import { zipSync, unzipSync } from "fflate";
import fileUtil from "../utils/fileUtil";

const group = new httpz.Group();
group.route("*", /\/videomaker\/full\/(\w+)\/tutorial$/, (req, res) => {
	const theme = req.matches[1];
	res.redirect(`/go_full?tray=${theme}&tutorial=0`);
});
group.route("GET", "/dashboard/videos", (req, res) => {
	res.setHeader("Content-Type", "text/html");
	res.end("<script>window.appWindow.goHome();</script>");
});
group.route("*", /\/file\/movie\/thumb\/([^/]+)$/, (req, res) => {
	const id = req.matches[1];
	try {
		const readStream = MovieModel.thumb(id);
		res.setHeader("Content-Type", "image/png");
		readStream.pipe(res);
	} catch (err) {
		if (err == "404") {
			return res.status(404).end();
		}
		console.log(req.parsedUrl.pathname, "failed. Error:", err);
		res.status(500).end();
	}
});
group.route("GET", "/api/movie/get_info", (req, res) => {
	const id = req.query.id;
	if (!id) {
		return res.status(400).json({ msg: "Movie ID missing" });
	}
	const movie = Database.get("movies", id);
	if (movie) {
		return res.json(movie.data);
	}
	const starters = Database.select("assets", { id, type: "movie" });
	if (starters.length > 0) {
		return res.json(starters[0]);
	}
	res.status(404).json({ msg: "Movie not found" });
});
group.route("GET", "/api/movie/list", (req, res) => {
	const type = req.query.type;
	const basePath = req.query.path;
	if (!type) {
		return res.status(400).json({ msg: "Expected type parameter" });
	}
	let movies: Movie[];
	switch (type) {
		case "starter":
			movies = Database.select("assets", { type: "movie" }) as any as Movie[];
			return res.json({ movies });
		case "movie":
		default:
			const dbRes = Database.select("movies");
			movies = Array.isArray(dbRes) ? dbRes : [];
	}
	movies = (movies || []).filter((m) => {
		return basePath ? m.parent_id == basePath : !m.parent_id;
	});
	const folders = Database.select("movie_folders", {
		parent_id: basePath ? basePath : "/",
	});
	let folderPath = [];
	if (basePath) {
		let rootFound = false;
		let currentId = basePath;
		while (!rootFound) {
			const dbRes = Database.get("movie_folders", currentId);
			if (!dbRes) {
				if (currentId == basePath) {
					return res.status(404).json({ msg: "Path does not exist" });
				}
				res.log(`Parent folder with ID "${currentId}" not found, returning with empty folder path...`);
				folderPath = [];
				break;
			}
			const folder = dbRes.data;
			currentId = folder.parent_id;
			if (currentId == "/") {
				rootFound = true;
				currentId = null;
			}
			folderPath.unshift({
				id: folder.id,
				title: folder.title,
			});
		}
	}
	res.json({ folder_path: folderPath, folders, movies });
});
group.route("GET", "/api/movie/rename_folder", (req, res) => {
	const { new: newName, path } = req.query;
	if (!newName) {
		return res.status(400).json({ msg: "Expected newName parameter" });
	}
	if (!path) {
		return res.status(400).json({ msg: "Expected path parameter" });
	}
	try {
		MovieModel.renameFolder(path, newName);
		res.json({ status: "ok" });
	} catch (e) {
		if (e == "404") {
			return res.status(404).json({ status: "error" });
		}
		console.error(req.parsedUrl.pathname, "failed. Error:", e);
		res.status(500).json({ status: "error" });
	}
});
group.route("POST", "/api/movie/move_selection", (req, res) => {
	const movies: string[] | void = req.body.movies;
	const movieFolders: string[] | void = req.body.movie_folders;
	const newParentId: string | void = req.body.new_parent_id;
	if ((!movies && !movieFolders) || !newParentId) {
		return res.status(400).json({ msg: "A required parameter is missing" });
	}
	try {
		MovieModel.moveToFolder(
			{
				movieIds: movies || [],
				movieFolderIds: movieFolders || [],
			},
			newParentId
		);
		res.json({ status: "ok" });
	} catch (e) {
		switch (e) {
			case "t-404":
				return res.status(404).json({ status: "Specified target folder does not exist" });
			case "m-404":
				return res.status(404).json({ status: "Specified movie does not exist" });
			case "f-404":
				return res.status(404).json({ status: "Specified folder does not exist" });
			default: {
				console.error(req.parsedUrl.pathname, "failed. Error:", e);
				res.status(500).json({ status: "error" });
			}
		}
	}
});
group.route("GET", "/api/movie/delete_folder", (req, res) => {
	const { path } = req.query;
	if (!path) {
		return res.status(400).json({ msg: "Expected path parameter" });
	}
	try {
		MovieModel.deleteFolder(path);
		res.json({ status: "ok" });
	} catch (e) {
		if (e == "404") {
			return res.status(404).json({ status: "error" });
		}
		console.error(req.parsedUrl.pathname, "failed. Error:", e);
		res.status(500).json({ status: "error" });
	}
});
group.route("POST", "/api/movie/delete", async (req, res) => {
	const idField = req.body.id as string;
	if (typeof idField == "undefined") {
		return res.status(400).json({ msg: "Missing required parameters" });
	}
	const ids = idField.split(",");
	for (const id of ids) {
		try {
			await MovieModel.delete(id);
			res.log("Deleted movie " + id);
		} catch (err) {
			if (err == "404") {
				res.log(`Failed to delete movie ${id} -- Movie does not exist`);
				res.log(`Skipping movie ${id}...`);
			}
			res.log(`Failed to delete movie ${id} -- ${err}`);
			const remaining = ids.slice(id.indexOf(id));
			res.log("Stopping movie deletion! Remaining: " + JSON.stringify(remaining));
			return res.status(500).json({ msg: "Internal server error" });
		}
	}
	res.end();
});
group.route("POST", "/api/movie/upload", async (req, res) => {
	const file = req.files.import;
	const isStarter = req.body.is_starter === "1" || req.body.is_starter === "true";
	if (typeof file == "undefined") {
		return res.status(400).json({ msg: "No files selected" });
	}
	const charPath = file.filepath;
	const buffer = fs.readFileSync(charPath);
	const isZip = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
	if (!isZip) {
		if (fs.existsSync(charPath)) fs.unlinkSync(charPath);
		console.error("Movie import blocked: Not a Wrapper offline video");
		return res.status(400).json({ msg: "The file is invalid" });
	}
	try {
		const files = unzipSync(new Uint8Array(buffer));
		const hasUgc = "ugc.xml" in files;
		const hasMovie = "movie.xml" in files;
		if (!hasUgc || !hasMovie) {
			if (fs.existsSync(charPath)) fs.unlinkSync(charPath);
			console.error(`Movie import blocked: Missing required XMLs (ugc: ${hasUgc}, movie: ${hasMovie})`);
			return res.status(400).json({ msg: "Invalid project file, there is no ugc.xml inside the ZIP" });
		}
		const id = await MovieModel.upload(buffer, isStarter);
		if (fs.existsSync(charPath)) fs.unlinkSync(charPath);
		console.log(`[Success] Movie imported: ${id}`);
		res.json({ status: "Movie imported successfully", id: id });
	} catch (err) {
		console.error("Movie import error:", err);
		if (fs.existsSync(charPath)) fs.unlinkSync(charPath);
		res.status(500).json({ msg: "An error happened during video importation" });
	}
});
group.route(
	"*",
	/^\/file\/movie\/file\/([^/]+)|\/goapi\/getMovie\/$/,
	async (req, res) => {
		const isPost = req.method == "POST";
		const idField = isPost ? req.query.movieId : req.matches[1];
		if (typeof idField == "undefined") {
			return res.status(400).end("ID not specified");
		}
		const ids = idField.split(",");
		const outerFiles: Record<string, Uint8Array> = {};
		let singleZipBuf: Buffer | null = null;
		for (const id of ids) {
			try {
				const zipped = await MovieModel.packMovie(id);
				if (ids.length === 1) {
					singleZipBuf = zipped;
					break;
				}
				fileUtil.addToZip(outerFiles, id + ".zip", zipped);
			} catch (err) {
				if (err == "404") {
					return res.status(404).end("Movie doesn't exist");
				}
				res.log("Error packing movie #" + JSON.stringify(ids) + ": " + err);
				res.status(500).end("Internal server error");
				return;
			}
		}
		let zipBuf: Buffer;
		if (singleZipBuf) {
			zipBuf = singleZipBuf;
		} else {
			zipBuf = Buffer.from(zipSync(outerFiles));
		}
		if (isPost) {
			zipBuf = Buffer.concat([Buffer.alloc(1, 0), zipBuf]);
		}
		res.setHeader("Content-Type", "application/zip");
		res.end(zipBuf);
	}
);
group.route("POST", ["/goapi/saveMovie/", "/goapi/saveTemplate/"], async (req, res) => {
	const zipField = req.body.body_zip;
	if (typeof zipField == "undefined") {
		return res.status(400).end("Expected body_zip field");
	}
	const movieId = req.body.movieId;
	const thumbField = req.body.thumbnail_large;
	const trigAutosave = req.body.is_triggered_by_autosave;
	if (!thumbField) {
		if (trigAutosave && !movieId) {
			return res.end("0");
		}
		if (!trigAutosave) {
			return res.status(400).end("No is_triggered_by_autosave, expected thumbnail_large field");
		}
	}
	const body = Buffer.from(zipField, "base64");
	let thumb: Buffer | void;
	if (thumbField) {
		thumb = Buffer.from(thumbField, "base64");
	}
	if (!body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
		return res.status(400).end("body_zip is not a ZIP");
	}
	try {
		const files = unzipSync(new Uint8Array(body));
		const movieXmlU8 = files["movie.xml"];

		if (!movieXmlU8) {
			return res.status(400).end("movie.xml not found in zip");
		}
		const movieXml = Buffer.from(movieXmlU8);
		const saveAsStarter = req.parsedUrl.pathname == "/goapi/saveTemplate/";
		const id = await MovieModel.save(movieXml, thumb, movieId, saveAsStarter);
		res.log("Successfully saved movie " + id);
		res.end("0" + id);
	} catch (err) {
		if (err == "404") {
			return res.status(404).end("Specified movie does not exist");
		}
		res.log("Error saving movie: " + err);
		res.status(500).end("1" + err);
	}
});

export default group;
