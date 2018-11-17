import { isArray, isPlainObject } from '@ditojs/utils'

// @vue/component
export default {
  methods: {
    // Async versions of Vue's $on() and $off() methods that keep track of the
    // events added / removed, and provide a responds() method that checks if
    // the component responds to a given event.

    // Also adds proper handling of async events, including a async emit() that
    // deals with proper event queueing.
    on(event, callback) {
      if (isArray(event)) {
        for (const ev of event) {
          this.on(ev, callback)
        }
      } else if (isPlainObject(event)) {
        for (const key in event) {
          this.on(key, event[key])
        }
      } else {
        const events = this.events || (this.events = Object.create(null))
        const { callbacks } = events[event] || (events[event] = {
          callbacks: [],
          queue: []
        })
        callbacks.push(callback)
      }
      return this
    },

    once(event, callback) {
      const on = (...args) => {
        this.off(event, on)
        return callback.apply(this, args)
      }
      on.callback = callback // Needed for `off()`, see below.
      this.on(event, on)
      return this
    },

    off(event, callback) {
      if (!arguments.length) {
        // Remove all events
        delete this.events
      } else if (isArray(event)) {
        for (const ev of event) {
          this.off(ev, callback)
        }
      } else if (isPlainObject(event)) {
        for (const key in event) {
          this.off(key, event[key])
        }
      } else {
        // Remove specific event
        const entry = this.events?.[event]
        if (entry) {
          if (!callback) {
            // Remove all handlers for this event
            delete this.events[event]
          } else {
            // Remove a specific handler: find the index of its wrapper
            const { wrappers } = entry
            const index = wrappers.findIndex(
              // Match `cb.callback` also, as used by `once()`, see  above:
              ({ callback: cb }) => cb === callback || cb.callback === callback
            )
            if (index !== -1) {
              wrappers.splice(index, 1)
            }
          }
        }
      }
      return this
    },

    emit(event, ...args) {
      // Only queue if it actually responds to it.
      const entry = this.events?.[event]
      if (entry) {
        const { queue, callbacks } = entry
        return new Promise(resolve => {
          const next = async () => {
            // Emit the next event in the queue with its params.
            // Note that it only gets removed once `next()` is called.
            const entry = queue.shift()
            if (entry) {
              let result
              for (const callback of callbacks) {
                try {
                  const res = await callback.apply(this, entry.args)
                  if (res !== undefined) {
                    result = res
                  }
                } catch (err) {
                  console.error(`event handler for '${event}': `, err)
                }
              }
              // Resolve the promise that was added to the queue for the event
              // that was just completed by the wrapper that called `next()`
              entry.resolve(result)
              next()
            }
          }
          queue.push({ args, resolve })
          // For new queues (= only one entry) emit the first event immediately,
          // to get the queue running.
          if (queue.length === 1) {
            next()
          }
        })
      }
    },

    // Checks if the components responds to a given event type:
    responds(event) {
      if (isArray(event)) {
        for (const ev of event) {
          if (this.responds(ev)) {
            return true
          }
        }
        return false
      } else {
        return !!this.events?.[event]
      }
    },

    delegate(event, target) {
      if (target) {
        if (isArray(event)) {
          for (const ev of event) {
            this.delegate(ev, target)
          }
        } else {
          this.on(event, (...args) => target.emit(event, ...args))
        }
      }
      return this
    }
  }
}
