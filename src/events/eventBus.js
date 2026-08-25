import { EventEmitter } from 'events';
class EventBus {
    emitter;
    constructor() {
        this.emitter = new EventEmitter();
    }
    /**
     * Publishes an event to the EventBus.
     * @param eventName The name of the event (e.g., 'Booking.Created')
     * @param payload The data associated with the event
     */
    publish(eventName, payload) {
        // We log the event publication for debugging in dev
        // In production, this can be swapped to push to Redis/Kafka
        this.emitter.emit(eventName, payload);
    }
    /**
     * Subscribes to an event on the EventBus.
     * @param eventName The name of the event to listen for
     * @param listener The callback to execute when the event occurs
     */
    subscribe(eventName, listener) {
        this.emitter.on(eventName, async (payload) => {
            try {
                await listener(payload);
            }
            catch (error) {
                // We catch all errors in event listeners so they NEVER crash the main event loop
                console.error(`[EventBus] Error in listener for event '${eventName}':`, error);
            }
        });
    }
    /**
     * Removes a subscription from the EventBus.
     * @param eventName The name of the event
     * @param listener The callback to remove
     */
    unsubscribe(eventName, listener) {
        this.emitter.removeListener(eventName, listener);
    }
}
// Export a singleton instance
export const eventBus = new EventBus();
