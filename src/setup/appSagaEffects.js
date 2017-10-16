import appModels from './appModels'
import { each, flatten } from 'lodash'
import { authService } from 'services'
import { put, call, takeEvery, select, take, fork } from 'redux-saga/effects'
import { delay } from 'redux-saga'
import invariant from 'invariant'

function extractModelEffects (model) {
  const { namespace, effects, watchers = [] } = model
  each(effects, (v, k) => {
    function * effectFunction (action) {
      yield v(action, { simplePut: enableSimplePut(namespace), put, call, select, delay, take })
    }

    function * watcher () {
      // 設定 action type 與 saga 的關聯
      // 如果 match pattern 就會執行 saga effect function
      yield takeEvery(`${namespace}/${k}`, effectFunction)
    }

    watchers.push(watcher())
  })

  return watchers
}

// HOF: return simplePut(type, payload)
const enableSimplePut = namespace => (type, payload) => {
  // call within same model should not use universal type
  const redundantUniversalTypeRegex = new RegExp(`^${namespace}/`)
  invariant(!redundantUniversalTypeRegex.test(type), `
    Please check type: '${type}'.
    UniversalType is not allowed in calling within same model.
    Please use local type without namesapce: '${namespace}'.
  `)

  // check whether type is universal or not (universal if any / appears)
  const universalTypeRegex = /\//
  const isUniversalType = universalTypeRegex.test(type)

  const universalType = isUniversalType
    ? type
    : `${namespace}/${type}`

  return put({ type: universalType, payload })
}

// combineModelEffects
function combineModelEffects (models, effects) {
  each(models, m => effects.push(extractModelEffects(m)))
  const flattenedEffects = flatten(effects)
  // 最終整理出 root saga watchers 陣列 (可能包括 fork, takeEvery 各種功能)
  return function * () { yield flattenedEffects }
}

// 因為系統需要先載入參數檔
// 後續才能依據此參數進行後續動作
// 因此在 root saga 加入 fork 動作來觸發此行為 (extraSagaEffects)
// 並且在完成此工作後 put 成功的 action

// 其他一樣進入系統後同時會執行的動作中會存在以下 take 代碼
// yield take('app/setSystemConfig')
// const systemConfig = yield select(state=>state.app.systemConfig);
// 即使 saga 已經被觸發該但仍會在 take 中等待該 action 被觸發
// 表示等待載入參數檔成功後(獲得資料)才得以接續執行後續行為

function * preloadSystemConfig () {
  try {
    // get system config
    const config = yield call(authService.getSystemConfig)
    // 1. tell the store to save the system config
    // 2. activate other executing saga which use => yield take('app/setSystemConfig') to waits for config to be loaded
    yield put({ type: 'app/setSystemConfig', payload: config }) // reducer, not saga!!
  } catch (error) {
    console.log('error:', error)
  }
}

// define extra SagaWatchers
const extraSagaEffects = [
  fork(preloadSystemConfig)
]

export default combineModelEffects(appModels, extraSagaEffects)