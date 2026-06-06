import { createHostLink, createClientLink } from "./peerLink";

const PRESENTATION_CHANNEL = "worshipDeck.presentation";

// Unified presentation transport.
// - BroadcastChannel: presenter <-> audience window on the SAME machine (instant, local).
// - WebRTC peer link: presenter <-> phone controller across devices (PeerJS, no backend).
//
// role: "presenter" = BroadcastChannel + WebRTC host
//       "audience"  = BroadcastChannel only (local projector window)
//       "controller"= WebRTC client only (phone, separate device)
export function createPresentationBus({ role, roomId, onMessage, onStatus } = {}) {
  let broadcastChannel = null;
  let peerLink = null;
  let closed = false;

  const handle = (message) => {
    if (!closed) {
      onMessage?.(message);
    }
  };

  const usesBroadcast = role === "presenter" || role === "audience";
  if (usesBroadcast && typeof BroadcastChannel !== "undefined") {
    broadcastChannel = new BroadcastChannel(PRESENTATION_CHANNEL);
    broadcastChannel.onmessage = (event) => handle(event.data);
  }

  if (role === "presenter" && roomId) {
    peerLink = createHostLink({ roomId, onMessage: handle, onStatus });
  } else if (role === "controller" && roomId) {
    peerLink = createClientLink({ roomId, onMessage: handle, onStatus });
  }

  return {
    post(message) {
      if (closed) {
        return;
      }
      broadcastChannel?.postMessage(message);
      peerLink?.post(message);
    },
    close() {
      closed = true;
      broadcastChannel?.close();
      peerLink?.close();
    }
  };
}
