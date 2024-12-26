import { player, MetaEntryReceiver$ } from './stateVariables';
import { MetaEntry } from './types';
import { map, distinctUntilChanged } from 'rxjs/operators';
const playPauseButton = document.getElementById('play-pause') as HTMLButtonElement;
const progressBar = document.getElementById('progress-bar') as HTMLInputElement;
const progressPlayed = document.getElementById('progress-played') as HTMLDivElement;
const progressBuffered = document.getElementById('progress-buffered') as HTMLDivElement;
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
const fullscreenButton = document.getElementById('fullscreen') as HTMLButtonElement;
const playIcon = document.getElementById('play-icon') as HTMLImageElement;
const pauseIcon = document.getElementById('pause-icon') as HTMLImageElement;
const fullscreenIcon = document.getElementById('fullscreen-icon') as HTMLImageElement;
const minimizeIcon = document.getElementById('minimize-icon') as HTMLImageElement;
const muteUnmuteButton = document.getElementById('mute-unmute') as HTMLButtonElement;
const volumeIcon = document.getElementById("volume-icon") as HTMLImageElement;
const muteIcon = document.getElementById("mute-icon") as HTMLImageElement;
const liveIndicator = document.getElementById("live-indicator") as HTMLImageElement;
const videoContainer = document.getElementById('video-container') as HTMLDivElement;
const videoOverlay = document.getElementById('video-overlay') as HTMLDivElement;
const timeDisplay = document.getElementById('time-display') as HTMLSpanElement;

export function initStyle(){
  let mouseMoveTimeout: any;

  MetaEntryReceiver$
  .pipe(
    map((value: MetaEntry[]) => value[value.length - 1]?.end || 0), 
    distinctUntilChanged() 
  )
  .subscribe(updateBufferedBar);

  function updateBufferedBar(lastBufferedTimeRange: number){
    const bufferedWidth = (lastBufferedTimeRange / player.duration) * 100;
    progressBuffered.style.width = `${bufferedWidth}%`;
  }

  function showOverlay() {
    videoOverlay.style.opacity = '1';
    clearTimeout(mouseMoveTimeout);
    mouseMoveTimeout = setTimeout(() => {
      videoOverlay.style.opacity = '0';
    }, 2000);
  }

  videoContainer.addEventListener('mousemove', showOverlay);

  player.addEventListener('click', (event) => {
    if (event.target !== videoOverlay){
      playPause()
    }
  });

  player.addEventListener('loadeddata', () => {
    showOverlay();
    setPlayerDurationDisplay(player.duration);
    updateProgessBar(player.currentTime);
  });
     

  playPauseButton.addEventListener('click', () => {
    playPause();
  });

  // Vollbild-Toggle
  fullscreenButton.addEventListener('click', () => {
    console.log("Fullscreen");
    if (document.fullscreenElement) {
      document.exitFullscreen();
      fullscreenIcon.style.display = 'block';
      minimizeIcon.style.display = 'none';
    } else {
      const container = document.getElementById('video-container')!;
      container.requestFullscreen();
      fullscreenIcon.style.display = 'none';
      minimizeIcon.style.display = 'block';
    }
  });

  // Fortschrittsbalken aktualisieren
  //Trigger schlecht wenn Video pausiert/startet
  player.addEventListener('timeupdate', () => {
    updateProgessBar(player.currentTime);

  });

  // Lautstärke
volumeSlider.addEventListener('input', () => {
  const volumeValue = (parseFloat(volumeSlider.value));
  document.documentElement.style.setProperty('--volume-progress', `${volumeValue}%`);
  console.log(volumeValue);
  // Toggle mute/unmute icon based on volume
  if (volumeValue === 0.0) {
    volumeIcon.style.display = 'none';
    muteIcon.style.display = 'block';
  } else {
    volumeIcon.style.display = 'block';
    muteIcon.style.display = 'none';
  }

  player.volume = volumeValue / 100;
});

  // Fortschritt setzen
  progressBar.addEventListener('input', () => {
    const time = (parseFloat(progressBar.value) / 100) * player.duration;
    player.currentTime = time;
  });

  //Mute Toggle
  muteUnmuteButton.addEventListener('click', () => {
    if (player.muted) {
      player.muted = false;
      volumeIcon.style.display = "inline";
      muteIcon.style.display = "none";
      document.documentElement.style.setProperty('--volume-progress', `100%`);
    } else {
      player.muted = true;
      volumeIcon.style.display = "none";
      muteIcon.style.display = "inline";
      document.documentElement.style.setProperty('--volume-progress', `0%`);
    }
  });

  window.addEventListener("resize", () => {
      const videoContainer = document.querySelector(".video-container") as HTMLDivElement;
      if (videoContainer) {
        const aspectRatio = 16 / 9;
        const width = Math.min(window.innerWidth * 0.9, 800);
        videoContainer.style.width = `${width}px`;
        videoContainer.style.height = `${width / aspectRatio}px`;
      }
  });

}

export function toggelLiveIndicator(){
  if(liveIndicator.style.opacity === "1"){
    liveIndicator.style.opacity = "0";
  }else{
    liveIndicator.style.opacity = "1";
  }
}


export function playPause() {
  if (player.paused) {
    player.play();
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  } else {
    player.pause();
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  }
}
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

export function setPlayerDurationDisplay(duration: number){
    const display = `0:00 / ${formatTime(duration)}`;
    timeDisplay.textContent = display;
}

export function updatePlayerDurationDisplay(currentTime: number, duration: number){
  const display = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  timeDisplay.textContent = display;
}

export function updateProgessBar(currentTime: number, duration: number = player.duration){
  const value = (currentTime / player.duration) * 100 || 0;
  progressBar.value = value.toString();
  progressBar.style.setProperty('--progress-value', `${value}%`);
  const additionalPixels = 6 * (1 - value / 100);//Für die Rundung/Kreis des Balkens
  progressPlayed.style.width = `calc(${value}% + ${additionalPixels}px)`;
  updatePlayerDurationDisplay(currentTime, duration);

  const buffered = player.buffered;
  if (buffered.length > 0) {
    const bufferedEnd = buffered.end(buffered.length - 1);
    const bufferedWidth = (bufferedEnd / player.duration) * 100;
    progressBuffered.style.width = `${bufferedWidth}%`;
  }
}