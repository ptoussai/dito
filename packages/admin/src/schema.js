import TypeComponent from './TypeComponent'
import DitoView from '@/components/DitoView'
import { isFunction, isPromise } from '@ditojs/utils'

export async function processView(schema, name, api, routes) {
  if (schema.type === 'view') {
    schema.path = schema.path || api.normalizePath(name)
    schema.name = name
    const meta = {
      api,
      schema
    }
    const path = `/${schema.path}`
    const children = []
    await processSchemaComponents(schema, api, children, meta, 0)
    const [route] = children
    if (route?.component === DitoView) {
      // The view contains a list that already produced the route for this view,
      // just adjust it to reflect its nesting in the view:
      route.meta.schema = schema
      route.meta.listSchema.path = schema.path
      route.path = path
      routes.push(route)
    } else {
      routes.push({
        path,
        children,
        component: DitoView,
        meta
      })
    }
  } else {
    // A single-component view
    return processComponent(schema, name, api, routes)
  }
}

export function processComponent(schema, name, api, routes,
  parentMeta = null, level = 0) {
  // Delegate processing to the actual type components.
  return TypeComponent.get(schema.type)?.options.processSchema?.(
    schema, name, api, routes, parentMeta, level)
}

export function processSchemaComponents(schema, api, routes,
  parentMeta = null, level = 0) {
  const promises = []
  const process = components => {
    for (const [name, component] of Object.entries(components || {})) {
      promises.push(
        processComponent(component, name, api, routes, parentMeta, level)
      )
    }
  }
  for (const tab of Object.values(schema?.tabs || {})) {
    process(tab.components, processComponent)
  }
  process(schema?.components, processComponent)
  return Promise.all(promises)
}

export async function processForms(schema, api, parentMeta, level) {
  // First resolve the forms and store the results back on the schema.
  let { form, forms } = schema
  if (forms) {
    forms = schema.forms = await resolveForms(forms)
  } else if (form) {
    form = schema.form = await resolveForm(form)
    forms = { default: form } // Only used for loop below.
  }
  const children = []
  if (forms) {
    const promises = Object.values(forms).map(
      form => processSchemaComponents(
        form, api, children, parentMeta, level + 1
      )
    )
    await Promise.all(promises)
  }
  return children
}

export async function resolveForm(form) {
  if (isFunction(form)) {
    form = form()
  }
  if (isPromise(form)) {
    form = await form
  }
  // When dynamically importing forms, try figuring out and setting their
  // name, if they were declared as named imports:
  if (form && !form.components) {
    const name = Object.keys(form)[0]
    form = form[name]
    if (name !== 'default') {
      form.name = name
    }
  }
  return form
}

export async function resolveForms(forms) {
  // Basically Promise.props() without bluebird:
  const results = await Promise.all(Object.values(forms).map(resolveForm))
  return Object.keys(forms).reduce(
    (mapped, key, index) => {
      mapped[key] = results[index]
      return mapped
    },
    {}
  )
}
