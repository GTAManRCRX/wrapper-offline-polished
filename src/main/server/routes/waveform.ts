import Directories from "../../storage/directories";
import fs from "fs";
import { Group } from "../miniHttp";
import path from "path";
import Settings from "../../storage/settings";
import WfModel from "../models/waveform";

const group = new Group();

group.route("POST", "/goapi/getWaveform/", async (req, res) => {
	const SHOW_WAVEFORMS = Settings.showWaveforms;
	if (SHOW_WAVEFORMS) {
		const id = req.body.wfid;
		if (!id) {
			return res.status(500).end("Missing one or more fields");
		}
		try {
			const waveform = WfModel.load(id);
			if (waveform) {
				return res.status(200).end(waveform);
			} else {
				return res.status(200).end(); 
			}
		} catch (err) {
			if (err == "404") {
				return res.status(200).end();
			}
			console.log(req.parsedUrl.pathname, "failed. Error:", err);
			res.status(500).end();
		}
	} else {
		const filepath = path.join(Directories.static, "waveform.txt");
		if (fs.existsSync(filepath)) {
			fs.createReadStream(filepath).pipe(res);
		} else {
			res.status(200).end("0");
		}
	}
});
group.route("POST", "/goapi/saveWaveform/", (req, res) => {
	const { waveform } = req.body;
	const id = req.body.wfid;
	if (!id) {
		return res.status(500).end("Missing one or more fields");
	}

	try {
		WfModel.save(waveform, id);
		res.end("0");
	} catch (e) {
		if (e == "404") {
			return res.status(404).end("1");
		}
		console.error(req.parsedUrl.pathname, "failed. Error:", e);
	}
});

export default group;
