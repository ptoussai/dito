import { isArray, isObject, isDate, isRegExp, isFunction } from '@/base'
import { pick } from '@/object'

export function clone(arg, iteratee = null) {
  let copy
  if (isDate(arg)) {
    copy = new arg.constructor(+arg)
  } else if (isRegExp(arg)) {
    copy = new arg.constructor(arg)
  } else if (isObject(arg)) {
    if (isFunction(arg.clone)) {
      copy = arg.clone()
    } else {
      // Prevent calling the actual constructor since it is not guaranteed to
      // work as intended here, and only clone the non-inherited properties.
      copy = Object.create(Object.getPrototypeOf(arg))
      for (const key of Object.keys(arg)) {
        copy[key] = clone(arg[key], iteratee)
      }
    }
  } else if (isArray(arg)) {
    copy = new arg.constructor(arg.length)
    for (let i = 0, l = arg.length; i < l; i++) {
      copy[i] = clone(arg[i], iteratee)
    }
  } else {
    copy = arg
  }
  return pick(iteratee?.(copy), copy)
}
