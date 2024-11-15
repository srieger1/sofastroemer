import "./style.css"
import "video.js/dist/video-js.css"
import videojs from "video.js"
import { Peer, DataConnection } from "peerjs"
import $ from "jquery";


type PeersMessage = {
  type: "peers";
  peers: Array<string>;
}

type SeekMessage = {
  type: "seek";
  pos: number;
}

type PlayMessage = {
  type: "play";
  pause: boolean;
}

type Message = PeersMessage | SeekMessage | PlayMessage;


let connections = new Map<string, DataConnection>();

const peer = new Peer()

const player = videojs("video", {})
player.src({src: "https://box.open-desk.net/Big Buck Bunny [YE7VzlLtp-4].mp4"});


function on_data(conn: DataConnection, msg: Message) {
  console.log("Data", conn.peer, msg)

  switch (msg.type) {
    case "peers":
      console.log("Recv peers", msg.peers)

      for (const id of msg.peers) {
        console.log("Recv peer conn", id)

        if (connections.has(id)) {
          continue;
        }

        const conn = peer.connect(id)
        on_connect(conn)
      }

      break;

    case "seek":
      console.log("Seeeeek");
      player.currentTime(msg.pos)
      break;

    case "play":
      console.log("Plaaaaaay")
      if (msg.pause) {
        player.pause()
      }

      if (!msg.pause) {
        player.play()
      }

      break;
  }
}

function on_connect(conn: DataConnection) {
  function update() {
    var peers = ""
    for (let x of connections.keys()) {
      peers += `${x}\n`
    }

    $("#peers").text(peers)
  }

  conn.on("open", () => {
    console.log("Connected to " + conn.peer)

    // Broadcast known connections
    conn.send({
      type: "peers",
      peers: [...connections.keys()]
    })

    connections.set(conn.peer, conn)
    update()
  })

  conn.on("close", () => {
    console.log("Disconnected from " + conn.peer)

    connections.delete(conn.peer)
    update()
  })

  conn.on("data", msg => {
    on_data(conn, msg as Message)
  })
}

peer.on("open", () => {
  console.log("ID", peer.id)

  $("#link").attr("href", `/#${peer.id}`)

  // Connect to seed peer, if any
  if (window.location.hash) {
    const id = window.location.hash.substring(1)
    console.log("Connecting to seed:", id)
  
    const conn = peer.connect(id)
    on_connect(conn)
  }
})

peer.on("connection", (conn) => {
  console.log("Got connection from ", conn.peer)

  on_connect(conn)
})


function broadcast(msg: Message) {
  console.log("Send", msg)
  for (const conn of connections.values()) {
    console.log("Send to", conn.peer, msg)
    conn.send(msg)
  }
}

player.on('play', () => broadcast({ type: "play", pause: false }));
player.on('pause', () => broadcast({ type: "play", pause: true }));
player.on('seeked', () => broadcast({ type: "seek", pos: player.currentTime() || 0 }));


window.addEventListener('resize', () => {
  const videoContainer = document.querySelector('.video-container') as HTMLDivElement;
  if (videoContainer) {
    const aspectRatio = 16 / 9;
    const width = Math.min(window.innerWidth * 0.9, 800);
    videoContainer.style.width = `${width}px`;
    videoContainer.style.height = `${width / aspectRatio}px`;
  }
});

