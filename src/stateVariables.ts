import { BehaviorSubject } from "rxjs";
import { MetaEntry, CurrentBufferSizes } from "./types";
export const player = document.querySelector("#video")! as HTMLVideoElement;

export const receiverTestVariable$ = new BehaviorSubject<any[]>([]);
export const bufferedBytesSender$ = new BehaviorSubject<number>(0);
export const mediaSourceStateAllPeers$ = new BehaviorSubject<boolean[]>([]);
export const seekedStateAllPeers$ = new BehaviorSubject<boolean[]>([]);
export const MetaEntryReceiver$ = new BehaviorSubject<MetaEntry[]>([]);
export const currentBufferSize$ = new BehaviorSubject<CurrentBufferSizes>({chunkSizes: [], totalBufferSize: 0});
export const liveStream$ = new BehaviorSubject<boolean>(false);

