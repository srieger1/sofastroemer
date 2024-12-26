import "./style.css";
import {defaultVideoURL} from "../shared/globalConstants";
import {initStyle} from "./style";
import { initReceiver } from "./receiver";
import { initSender } from "./sender";
import { initPeer } from "./peer";
import { player } from "./stateVariables";

//TODO:
//Play und Buffered Anzeige nicht schön(anders aktualisieren)
//Zeitanzeige aklualisieren
//Seeking (nicht synchron bei Default URLs)
//Stream Ending(EndOfStream) nicht immer korrekt
//Speicher und Chache Verwaltung
//Player Duration Live Steaming?
//Keep in Sync, live Streaming


//Seltenere Seiteneffekte/Fehler,(ziemlich sicher problem schlechte Speicherverwaltung):
//(3er Error im Player bei Seeking dadurch Schließt sich MediaSource)
//(Reviver Seeking)



// Default source
player.src = defaultVideoURL;

initPeer();
initReceiver();
initSender();
initStyle();