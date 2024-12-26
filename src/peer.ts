import { Peer, DataConnection } from "peerjs";
import $ from "jquery";
import { State, Message, MetaEntry } from "./types";
import { onChunkReceived, onHeaderReceived, onEndOfStreamRecived, onPlayerDurationReceived, onSeekedReceived} from "./receiver";
import { broadcastMediaSourceReady, broadcastReadyToSeek} from "./broadcastFunctions";
import { resetMediaSourceCompletely, addMediaSourceStateAllPeers, addSeekedStateAllPeers, waitForConditionRxJS, addliveStream} from "./utils";
import { MetaEntryReceiver$, player, liveStream$ } from "./stateVariables";
import { playPause } from "./style";

let state = new State();
let connections = new Map<string, DataConnection>();
const peer = new Peer();

export function initPeer() {
    async function on_data(conn: DataConnection, msg: Message) {
        console.log("Data", conn.peer, msg.type);
    
        switch (msg.type) {
        case "peers":
            console.log("Recv peers", msg.peers);
    
            for (const id of msg.peers) {
            if (connections.has(id)) {
                continue;
            }
            const conn = peer.connect(id);
            on_connect(conn);
            }
            break;
    
        case "state":
            if (State.eq(msg.state, state)) {
            break;
            }
            //Wir verändern den State des Players nur wenn der Buffer in einem Konsistenten Zustand ist
            //Streng genommen muss der Buffer dirkt abgefragt werden, aber schwer zu implementieren

            console.log("MetaEntryReceiver:", MetaEntryReceiver$.value, "State:", msg.state.pos);
            //Wir bekommen nur Probleme beim Seeken wenn keine Default URL verwendet wird
            if (player.src.startsWith("blob:")) {
                const start = performance.now();
                await waitForConditionRxJS((value: MetaEntry[]) => value.length > 1 && msg.state.pos >= value[0]?.start && msg.state.pos <= value[value.length - 1]?.end && !liveStream$.value, MetaEntryReceiver$);
                const end = performance.now();
                //Prüfen ob der Buffer in einem Konsistenten Zustand ist MetaEntryReceiver$.value[MetaEntryReceiver$.value.length - 1]?.end <= msg.state.pos
                console.log("Time to check condition, MetaEntryReciver contains the right first videoChunk:", end - start);
            }

            state = msg.state;
    
            player.currentTime = state.pos;
    
            if (!player.paused && !state.play) {
                playPause();
            }
    
            if (player.paused && state.play) {
                playPause();
            }
            break;
    
        case "chunk":
            onChunkReceived(msg.data);
            break;
        case "header":
            console.log("Header received");
            onHeaderReceived(msg.start, msg.end, msg.chunkSize);
            break;
        case "resettingMediaSource":
            if (msg.flag) {
            await resetMediaSourceCompletely();
            broadcastMediaSourceReady(true);
            }
            break;
        case "mediaSourceReady":
            if(msg.flag){
            addMediaSourceStateAllPeers(msg.flag);
            }
            break;
        case "endOfStream":
            onEndOfStreamRecived(msg.flag);
            break;
        case "playerDuration":
            onPlayerDurationReceived(msg.duration);
            break;
        case "seeked":
            await onSeekedReceived(msg.time);
            console.log("Broadcasting ready to seek");
            broadcastReadyToSeek(true);
            break;
        case "readyToSeek":
            if(msg.flag){
                console.log("Peers is ready to seek");
                addSeekedStateAllPeers(msg.flag);
            }
            break;
        case "stream":
            addliveStream(msg.stream);
            break;
        case "playPauseStreaming":
            if(msg.flag){
                if(player.paused){
                    player.play();
                }else{
                    player.pause();
                }
            }
            break;
        }
    }

    function on_connect(conn: DataConnection) {
        function update() {
        let peers = "";
        for (let x of connections.keys()) {
            peers += `${x}\n`;
        }
        $("#peers").text(peers);
        }
    
        conn.on("open", () => {
        console.log("Connected to " + conn.peer);
    
        conn.send({
            type: "peers",
            peers: [...connections.keys()],
        });
        connections.set(conn.peer, conn);
        update();
        });
    
        conn.on("close", () => {
        console.log("Disconnected from " + conn.peer);
        connections.delete(conn.peer);
        update();
        });
    
        conn.on("data", (msg) => {
        on_data(conn, msg as Message);
        });
    }
    
    peer.on("open", () => {
        console.log("ID", peer.id);
    
        $("#link").attr("href", `/#${peer.id}`);
    
        if (window.location.hash) {
        const id = window.location.hash.substring(1);
        console.log("Connecting to seed:", id);
    
        const conn = peer.connect(id);
        on_connect(conn);
        }
    });
    
    peer.on("connection", (conn) => {
        console.log("Got connection from ", conn.peer);
    
        on_connect(conn);
    });

    //Probleme treten auf zwischen VideoChunks derern Zeitversatz relativ groß ist
    player.addEventListener('error', (e) => {
        console.error('Error encountered:', e);
        // Try to recover
        if (player.readyState === 4) { // 4 = HAVE_ENOUGH_DATA
            console.log('Ignoring error and continuing playback.');
            player.play().catch(console.error);
        } 
        else if(player.error !== null){
            if(player.error.code === 3){
                console.log("Media Source Error");
                //Reset Media Source
                //broadcastResettingStream(position);
            }
        }
        else {
            console.error('Playback cannot continue.');
        }
    });


    
      
}
export function getConnections(): Map<string, DataConnection> {
    return connections;
}
export function getState(): State {
    return state;
}
export function setState(next: State) {
    state = next;
}