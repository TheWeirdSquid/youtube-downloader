import express, { application } from 'express';
import path from 'path';
import ffmpeg from 'ffmpeg';
import ytdl from 'ytdl-core';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import http from 'http';

const app = express();
const port = process.env.PORT || 8002;

app.use("/static", express.static('public'));
app.use(express.json());

/* PAGES */

app.get( "/", (req, res) => {
    res.sendFile(path.join(__dirname, '../html/index.html'));
});

app.get( "/converttomp3", (req, res) => {
    res.sendFile(path.join(__dirname, '../html/converttomp3.html'));
});

app.get( "/converttomp4", (req, res) => {
    const token = req.query.token;
    if (!token) { res.sendFile(path.join(__dirname, '../html/pickvideoquality.html')); }
    else { res.sendFile(path.join(__dirname, '../html/converttomp4.html')); }
});

// ping method
app.get( "/api/ping", (req, res) => {
    res.sendStatus(200);
});

/* UTILITIES */
type MP3ConvertInfo = {
    downloadPath: string,
    audioPath: string,
    progress: number,
    converting: boolean,
    finished: boolean,
    error: boolean,
    errorMessage: string,
}
type MP4ConvertInfo = {
    videoDownloadPath: string,
    audioDownloadPath: string,
    outputPath: string,
    videoTotalLength: number,
    audioTotalLength: number,
    videoDownloaded: number,
    audioDownloaded: number,
    progress: number,
    convertingAudio: boolean,
    convertingVideo: boolean,
    finished: boolean,
    error: boolean,
    errorMessage: string,
}
let downloadsMP3 = new Map<string, MP3ConvertInfo>();
let downloadsMP4 = new Map<string, MP4ConvertInfo>();
function unlinkPath(path: string) {
    fs.unlink(path, (err) => {});
}
type VideoQualityInfo = {
    quality: string,
    qualityLabel: string
}

/**
 * Verifies that a given video URL is a real youtube video.
 */
app.get( "/api/verify", (req, res) => {
    const url: string = req.query.url as string;

    if (!url) { res.status(400).send("'url' parameter is required."); return; }

    let isValidURL: boolean = ytdl.validateURL(url);
    res.send({ 'valid': isValidURL });
});

/**
 * Gets the progress of an mp3 conversion
 */
app.get( "/api/status/mp3", async (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP3.has(token);
    if (!isValidToken) { res.status(404).send('Invalid token.'); return; }

    let download = downloadsMP3.get(token);
    
    if (download.error) {
        res.send({
            'error': true,
            'message': download.errorMessage
        });
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.delete(token);
        return;
    }

    res.send({
        'progress': download.progress,
        'converting': download.converting,
        'finished': download.finished,
        'error': false,
    });
});

/**
 * Gets the progress of an mp4 conversion
 */
 app.get( "/api/status/mp4", async (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP4.has(token);
    if (!isValidToken) { res.status(404).send('Invalid token.'); return; }

    let download = downloadsMP4.get(token);
    
    if (download.error) {
        res.send({
            'error': true,
            'message': download.errorMessage
        });
        unlinkPath(download.videoDownloadPath);
        unlinkPath(download.audioDownloadPath);
        unlinkPath(download.outputPath);
        downloadsMP4.delete(token);
        return;
    }

    res.send({
        'progress': download.progress,
        'converting': download.convertingVideo && download.convertingAudio,
        'finished': download.finished,
        'error': false,
    });
});

/**
 * Gets the download of an mp3 conversion
 */
app.get( "/api/download/mp3", (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP3.has(token);
    if (!isValidToken) { res.status(404).send("Invalid token."); return; }

    let download = downloadsMP3.get(token);

    if (download.error) {
        res.status(500).send(download.errorMessage);
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.delete(token);
        return;
    }

    if (!download.finished) { res.status(400).send('Audio file is not ready for download.'); return; }

    res.sendFile(download.audioPath, (err) => {
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.delete(token);
    });
});

/**
 * Gets the download of an mp3 conversion
 */
 app.get( "/api/download/mp4", (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP4.has(token);
    if (!isValidToken) { res.status(404).send("Invalid token."); return; }

    let download = downloadsMP4.get(token);

    if (download.error) {
        res.status(500).send(download.errorMessage);
        unlinkPath(download.videoDownloadPath);
        unlinkPath(download.audioDownloadPath);
        unlinkPath(download.outputPath);
        downloadsMP4.delete(token);
        return;
    }

    if (!download.finished) { res.status(400).send('Audio file is not ready for download.'); return; }

    res.sendFile(download.outputPath, (err) => {
        unlinkPath(download.videoDownloadPath);
        unlinkPath(download.audioDownloadPath);
        unlinkPath(download.outputPath);
        downloadsMP4.delete(token);
    });
});

/**
 * Starts converting a youtube video to mp3.
 */
app.get( "/api/convert/mp3", (req, res) => {
    const youtubeURL: string = req.query.url as string;

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }

    const downloadPath: string = `/tmp/${uuid()}.mp4`;
    const audioPath: string = `/tmp/${uuid()}.mp3`;

    if (!ytdl.validateURL(youtubeURL)) { res.status(400).send('Not a valid YouTube video.'); return; }

    const videoToken: string = uuid();

    let download: MP3ConvertInfo = {
        downloadPath,
        audioPath,
        progress: 0,
        converting: false,
        finished: false,
        error: false,
        errorMessage: '',
    }
    downloadsMP3.set(videoToken, download);
    res.status(202).send({ 'token': videoToken });

    try {
        let stream = fs.createWriteStream(download.downloadPath);
        let video = ytdl(youtubeURL, { quality: 'highestaudio', filter: 'audioonly' });
        let pipe = video.pipe(stream);

        video.on('progress', (length: number, downloaded: number, totalLength: number) => {
            let download = downloadsMP3.get(videoToken);
            download.progress = Math.round((downloaded / totalLength) * 100);
            downloadsMP3.set(videoToken, download);
        });

        pipe.on('finish', async () => {
            let download = downloadsMP3.get(videoToken);
            download.converting = true;
            downloadsMP3.set(videoToken, download);

            try {
                let download = downloadsMP3.get(videoToken);
                let video = await new ffmpeg(download.downloadPath);
                await video.fnExtractSoundToMP3(download.audioPath);
                download.finished = true;
                downloadsMP3.set(videoToken, download);
                setTimeout(() => {
                    unlinkPath(download.downloadPath);
                    unlinkPath(download.audioPath);
                }, 10 * 60 * 1000); // remove both files in 10 minutes
            } catch (err) {
                let download = downloadsMP3.get(videoToken);
                download.error = true;
                download.errorMessage = 'Something went wrong when converting the video.';
                unlinkPath(download.downloadPath);
                unlinkPath(download.audioPath);
                downloadsMP3.set(videoToken, download);
                console.error(err);
            }
        });
    } catch (err) {
        let download = downloadsMP3.get(videoToken);
        download.error = true;
        download.errorMessage = 'Something went wrong when downloading the video.';
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.set(videoToken, download);
        console.error(err);
    }
});

/**
 * Starts converting a youtube video to mp4.
 */
app.get( "/api/convert/mp4", async (req, res) => {
    const youtubeURL: string = decodeURIComponent(req.query.url as string);
    const quality: string = decodeURIComponent(req.query.quality as string);

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }
    if (!quality) { res.status(400).send("'quality' parameter is required."); return; }

    const videoDownloadPath: string = `/tmp/${uuid()}.mp4`;
    const audioDownloadPath: string = `/tmp/${uuid()}.mp4`;
    const outputPath: string = `/tmp/${uuid()}.mp4`;

    if (!ytdl.validateURL(youtubeURL)) { res.status(400).send('Not a valid YouTube video.'); return; }

    const videoToken: string = uuid();

    let download: MP4ConvertInfo = {
        videoDownloadPath,
        audioDownloadPath,
        outputPath,
        videoTotalLength: null,
        audioTotalLength: null,
        videoDownloaded: null,
        audioDownloaded: null,
        progress: 0,
        convertingAudio: false,
        convertingVideo: false,
        finished: false,
        error: false,
        errorMessage: ''
    }
    downloadsMP4.set(videoToken, download);
    res.status(202).send({ 'token': videoToken });

    try {

        let video = await ytdl(youtubeURL, { filter: format => format.quality == quality && format.container == 'mp4' });
        let audio = await ytdl(youtubeURL, { quality: 'highestaudio' });

        // get video pipe
        let videoStream = fs.createWriteStream(download.videoDownloadPath);
        let videoPipe = video.pipe(videoStream);

        // get audio pipe
        let audioStream = fs.createWriteStream(download.audioDownloadPath);
        let audioPipe = audio.pipe(audioStream);

        audio.on('progress', (length: number, downloaded: number, totalLength: number) => {
            let download = downloadsMP4.get(videoToken);
            if (!download.audioTotalLength) {
                download.audioTotalLength = totalLength;
            }
            download.audioDownloaded = downloaded;

            if (download.audioTotalLength && download.audioDownloaded && download.videoTotalLength && download.videoDownloaded) {
                let totalDownloaded = download.audioDownloaded + download.videoDownloaded;
                let totalDownloadLength = download.audioTotalLength + download.videoTotalLength;
                download.progress = Math.round((totalDownloaded / totalDownloadLength ) * 100);
            }
            downloadsMP4.set(videoToken, download);
        });

        video.on('progress', (length: number, downloaded: number, totalLength: number) => {
            let download = downloadsMP4.get(videoToken);
            if (!download.videoTotalLength) {
                download.videoTotalLength = totalLength;
            }
            download.videoDownloaded = downloaded;

            if (download.audioTotalLength && download.audioDownloaded && download.videoTotalLength && download.videoDownloaded) {
                let totalDownloaded = download.audioDownloaded + download.videoDownloaded;
                let totalDownloadLength = download.audioTotalLength + download.videoTotalLength;
                download.progress = Math.round((totalDownloaded / totalDownloadLength ) * 100);
            }
            downloadsMP4.set(videoToken, download);
        });

        async function combine() {
            try {
                let download = downloadsMP4.get(videoToken);
                let video = await new ffmpeg(download.videoDownloadPath);
                video.addInput(download.audioDownloadPath);
                video.addCommand('-c:v', 'copy');
                video.addCommand('-c:a', 'aac');
                let result = await video.save(download.outputPath);
                download.finished = true;
                downloadsMP4.set(videoToken, download);
                setTimeout(() => {
                    unlinkPath(download.videoDownloadPath);
                    unlinkPath(download.audioDownloadPath);
                    unlinkPath(download.outputPath);
                }, 10 * 60 * 1000); // remove all files in 10 minutes
            } catch (err) {
                let download = downloadsMP4.get(videoToken);
                download.error = true;
                download.errorMessage = 'Something went wrong when converting the video.';
                unlinkPath(download.audioDownloadPath);
                unlinkPath(download.videoDownloadPath);
                unlinkPath(download.outputPath);
                downloadsMP4.set(videoToken, download);
                console.error(err);
            }
        }

        audioPipe.on('finish', async () => {
            audioPipe.close();
            let download = downloadsMP4.get(videoToken);
            download.convertingAudio = true;
            downloadsMP4.set(videoToken, download);

            if (download.convertingAudio && download.convertingVideo) {
                combine();
            }
        });

        videoPipe.on('finish', async () => {
            videoPipe.close();
            let download = downloadsMP4.get(videoToken);
            download.convertingVideo = true;
            downloadsMP4.set(videoToken, download);
            if (download.convertingAudio && download.convertingVideo) {
                combine();
            }
        });
    } catch (err) {
        let download = downloadsMP4.get(videoToken);
        download.error = true;
        download.errorMessage = 'Something went wrong when downloading the video.';
        unlinkPath(download.audioDownloadPath);
        unlinkPath(download.videoDownloadPath);
        unlinkPath(download.outputPath);
        downloadsMP4.set(videoToken, download);
        throw err;
    }
});

/** Gets video information and returns it as an object */
app.get( "/api/info/video", async (req, res) => {
    // parse request
    const youtubeURL: string = req.query.url as string;

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }

    // get video info
    const vidInfo: ytdl.videoInfo = await ytdl.getInfo(youtubeURL);

    // find necessary video information
    const vidName: string = vidInfo.videoDetails.title;
    const vidAuthor: string = vidInfo.videoDetails.ownerChannelName;
    let vidThumbnail: string = null;
    let largestQualityWidth: number = 0;
    for (let thumbnail of vidInfo.videoDetails.thumbnails) {
        if (thumbnail.width > largestQualityWidth) {
            largestQualityWidth = thumbnail.width;
            vidThumbnail = thumbnail.url
        }
    }

    // check if thumbnail doesn't exist
    if (vidThumbnail == null) {
        res.status(500).send('No thumbnail found for video!');
        return;
    }

    // find valid formats
    var validFormats: Array<VideoQualityInfo> = [];
    for (let format of vidInfo.formats) {
        if (format.container == 'mp4' && format.hasVideo && !format.hasAudio) { // ignore all formats that are not mp4
            let qualityAlreadyAdded = !validFormats.every(e => e.qualityLabel != format.qualityLabel); // will return true if this format's quality has already been added.
            if (!qualityAlreadyAdded) {
                validFormats.push({
                    quality: format.quality,
                    qualityLabel: format.qualityLabel
                });
            }
        }
    }

    // check if there are no valid video formats
    if (validFormats.length == 0) {
        res.status(500).send('No valid video formats found!');
        return;
    }

    res.send({
        url: youtubeURL,
        name: vidName,
        author: vidAuthor,
        thumbnailURL: vidThumbnail,
        formats: validFormats
    });
});

app.listen( port, () => {
    console.log(`Server started at http://localhost:${port}`);
});