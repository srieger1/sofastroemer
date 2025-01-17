import "./style.css";
import {defaultVideoURL} from "../shared/globalConstants";
import {initStyle} from "./style";
import { initReceiver } from "./receiver";
import { initSender } from "./sender";
import { initPeer } from "./peer";
import { player } from "./stateVariables";

//TODO:
//Seeking (nicht synchron bei Default URLs)
//Stream(Datei) Ending(EndOfStream) nicht immer korrekt
//Speicher und Chache Verwaltung(funktioniert in Chrome ziemlich gut, andere haben da Probleme)
//Player Duration Live Steaming?
//Keep in Sync, live Streaming?

// Default source
player.src = defaultVideoURL;//KEINE BLOB URL als Default sonst Probleme

initPeer();
initReceiver();
initSender();
initStyle();