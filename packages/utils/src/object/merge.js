import { isArray, isObject } from '@/base'
import { clone } from './clone'

export function merge(target, ...sources) {
  const _merge = (target, source) => {
    if (target && source && (
      isObject(target) && isObject(source) ||
      isArray(target) && isArray(source)
    )) {
      for (const key of Object.keys(source)) {
        const value = source[key]
        if (
          !_merge(target[key], value) &&
          (value !== undefined || !(key in target))
        ) {
          target[key] = clone(value)
        }
      }
      return true
    }
    return false
  }

  for (const source of sources) {
    _merge(target, source)
  }
  return target
}
