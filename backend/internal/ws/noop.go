package ws

// NoopBroadcaster discards every event. Used to wire the queue manager
// before the real Hub exists / when running without any WS clients.
type NoopBroadcaster struct{}

func (NoopBroadcaster) Broadcast(Event) {}
