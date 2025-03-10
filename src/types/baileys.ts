export interface IAppStateSyncKeyFingerprint {
    currentIndex?: null | number;
    deviceIndexes?: null | number[];
    rawId?: null | number;
}


export interface IAppStateSyncKeyData {
    fingerprint?: null | IAppStateSyncKeyFingerprint;
    keyData?: null | Uint8Array;
    timestamp?: null | number | Long;
}