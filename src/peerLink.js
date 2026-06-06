import Peer from "peerjs";

// WebRTC peer-to-peer link over PeerJS's free public cloud signaling.
// No backend deploy, no account, no API key. Signaling is only used to pair;
// once the DataConnection is open, slide control flows directly device-to-device.
//
// roles:
//   host   = presenter laptop. Claims `roomId` as its peer id, accepts phone connections.
//   client = phone controller. Connects to the host's `roomId`.

const PEER_OPTIONS = { debug: 1 };

export function createHostLink({ roomId, onMessage, onStatus }) {
  const peer = new Peer(roomId, PEER_OPTIONS);
  const connections = new Set();
  let destroyed = false;

  peer.on("open", (id) => onStatus?.({ type: "open", id }));

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      connections.add(conn);
      onStatus?.({ type: "peer-joined", count: connections.size });
      // a fresh phone joined: trigger an immediate sync from the host
      onMessage?.({ type: "audience-ready" });
    });
    conn.on("data", (data) => onMessage?.(data));
    conn.on("close", () => {
      connections.delete(conn);
      onStatus?.({ type: "peer-left", count: connections.size });
    });
    conn.on("error", () => {
      connections.delete(conn);
    });
  });

  peer.on("error", (error) => {
    onStatus?.({ type: "error", error: error?.type || String(error) });
  });

  return {
    post(message) {
      if (destroyed) {
        return;
      }
      connections.forEach((conn) => {
        if (conn.open) {
          try {
            conn.send(message);
          } catch {
            // ignore send failures
          }
        }
      });
    },
    close() {
      destroyed = true;
      connections.forEach((conn) => {
        try {
          conn.close();
        } catch {
          // ignore
        }
      });
      connections.clear();
      try {
        peer.destroy();
      } catch {
        // ignore
      }
    }
  };
}

export function createClientLink({ roomId, onMessage, onStatus }) {
  const peer = new Peer(undefined, PEER_OPTIONS);
  let connection = null;
  let destroyed = false;
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    if (destroyed) {
      return;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      if (!destroyed) {
        connect();
      }
    }, 1500);
  };

  const connect = () => {
    if (destroyed) {
      return;
    }
    connection = peer.connect(roomId, { reliable: true });

    connection.on("open", () => {
      onStatus?.({ type: "connected" });
      // ask the host for the current state right away
      onMessage?.({ type: "__connected" });
    });
    connection.on("data", (data) => onMessage?.(data));
    connection.on("close", () => {
      onStatus?.({ type: "disconnected" });
      scheduleReconnect();
    });
    connection.on("error", () => {
      onStatus?.({ type: "error" });
    });
  };

  peer.on("open", () => connect());

  peer.on("error", (error) => {
    const type = error?.type || String(error);
    onStatus?.({ type: "error", error: type });
    // host not online yet (or briefly gone): keep retrying
    if (type === "peer-unavailable") {
      scheduleReconnect();
    }
  });

  peer.on("disconnected", () => {
    if (!destroyed) {
      try {
        peer.reconnect();
      } catch {
        // ignore
      }
    }
  });

  return {
    post(message) {
      if (connection && connection.open) {
        try {
          connection.send(message);
        } catch {
          // ignore
        }
      }
    },
    close() {
      destroyed = true;
      window.clearTimeout(reconnectTimer);
      try {
        peer.destroy();
      } catch {
        // ignore
      }
    }
  };
}
