import { isFunction } from '@ditojs/utils'
import { getItem, getParentItem } from '@/utils/data'

// `ItemContext` instances are a thin wrapper around raw `context` objects,
// which themselves actually inherit from the linked `component` instance, so
// that they only need to provide the values that should be different than
// in the underlying component. In order to not expose all fields from the
// component, the wrapper is introduced:
// Use WeakMap for the raw `context` objects, so we don't have to pollute the
// actual `ItemContext` instance with it.
const contexts = new WeakMap()

function get(instance, key) {
  return contexts.get(instance)[key]
}

export class ItemContext {
  constructor(component, context) {
    // Use the provided params object / function, or create a new one:
    context = context
      ? (isFunction(context) ? context() : context)
      : {}
    context.component = component
    // Have `context` inherit from the `component` instance, so it can override
    // its values and still retrieve from it, and associate it with `this`
    // through `paramsMap`:
    contexts.set(this, Object.setPrototypeOf(context, component))
  }

  get value() {
    return get(this, 'value')
  }

  get name() {
    return get(this, 'name')
  }

  get dataPath() {
    return get(this, 'dataPath') || ''
  }

  get item() {
    // NOTE: While internally, we speak of `data`, in the API surface the
    // term `item` is used for the data that relates to editing objects:
    // If `data` isn't provided, we can determine it from rootData & dataPath:
    return get(this, 'data') || getItem(this.rootItem, this.dataPath, true)
  }

  // NOTE: `parentItem` isn't the closest data parent to `item`, it's the
  // closest parent that isn't an array, e.g. for relations or nested JSON
  // data.  This is why the term `item` was chosen over `data`, e.g. VS the
  // use of `parentData` in server-sided validation, which is the closest
  // parent. If needed, we could expose this data here too, as we can do all
  // sorts of data processing with `rootData` and `dataPath`.
  get parentItem() {
    const parentItem = getParentItem(this.rootItem, this.dataPath, true) || null
    return parentItem !== this.item ? parentItem : null
  }

  get rootItem() {
    return get(this, 'rootData') || null
  }

  get list() {
    return get(this, 'list')
  }

  get index() {
    return get(this, 'index')
  }

  get user() {
    return get(this, 'user') || null
  }

  get api() {
    return get(this, 'api') || null
  }

  get itemLabel() {
    return get(this, 'itemLabel') || null
  }

  get formLabel() {
    return get(this, 'formLabel') || null
  }

  get component() {
    return get(this, 'component') || null
  }

  // TODO: `ItemContext.target` was deprecated in favor of
  // `ItemContext.component` on 2020-09-11, remove later.
  get target() {
    return this.component
  }

  get schemaComponent() {
    return get(this, 'schemaComponent') || null
  }

  get formComponent() {
    return get(this, 'formComponent') || null
  }

  get viewComponent() {
    return get(this, 'viewComponent') || null
  }

  get dialogComponent() {
    return get(this, 'dialogComponent') || null
  }

  get panelComponent() {
    return get(this, 'panelComponent') || null
  }

  get sourceComponent() {
    return get(this, 'sourceComponent') || null
  }

  // These fields are only populated in the context of buttons that send
  // requests, see `ResourceMixin.emitButtonEvent()`:

  get request() {
    return get(this, 'request') || null
  }

  get response() {
    return get(this, 'response') || null
  }

  get resource() {
    return get(this, 'resource') || null
  }

  get error() {
    return get(this, 'error') || null
  }
}
