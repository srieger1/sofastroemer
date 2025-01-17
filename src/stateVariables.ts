import { BehaviorSubject } from "rxjs";
import { MetaEntry, CurrentBufferSizes, ReadyToSeekAtTime } from "./types";
export const player = document.querySelector("#video")! as HTMLVideoElement;

export const receiverTestVariable$ = new BehaviorSubject<any[]>([]);
export const bufferedBytesSender$ = new BehaviorSubject<number>(0);
export const mediaSourceStateAllPeers$ = new BehaviorSubject<boolean[]>([]);
export const seekedStateAllPeers$ = new BehaviorSubject<ReadyToSeekAtTime[]>([]);
export const MetaEntryReceiver$ = new BehaviorSubject<MetaEntry[]>([]);
export const currentBufferSize$ = new BehaviorSubject<CurrentBufferSizes>({chunkSizes: [], totalBufferSize: 0});
export const liveStream$ = new BehaviorSubject<boolean>(false);
export const playerRole$ = new BehaviorSubject<boolean>(false);//false = sender, true = receiver
export const thumbnailSpriteSheet$ = new BehaviorSubject<string[]>([]);
