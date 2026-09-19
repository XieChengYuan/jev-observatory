// The only source is the proxy's completed-call stream, ordered by database sequence.
export class CallQueue {
 constructor(cursor=0){this.cursor=cursor;this.ack=cursor;this.pending=[];this.active=null;}
 ingest(events){for(const event of events){if(event.seq<=this.cursor)continue;this.pending.push(event);this.cursor=event.seq;}}
 next(){if(!this.active)this.active=this.pending.shift()||null;return this.active?.call||null;}
 complete(id){if(this.active?.call.id!==id)return false;this.ack=this.active.seq;this.active=null;return true;}
 get waiting(){return this.pending.length;}
}
