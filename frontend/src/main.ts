import './style.css'
import 'video.js/dist/video-js.css';

import videojs from 'video.js';


const player = videojs('video', {})
player.src({src: 'https://box.open-desk.net/Big Buck Bunny [YE7VzlLtp-4].mp4'});

