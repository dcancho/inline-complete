import { CompletionCache } from '../src/cache'
import { cleanCompletion } from '../src/postprocess'

let failures = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.log(`FAIL ${name}`)
    console.log(`  expected ${JSON.stringify(expected)}`)
    console.log(`  actual   ${JSON.stringify(actual)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

const cache = new CompletionCache()
cache.store('var order = await _orders.', 'GetAsync(id, ct);')

check('exact hit', cache.lookup('var order = await _orders.'), 'GetAsync(id, ct);')
check('typed through', cache.lookup('var order = await _orders.Get'), 'Async(id, ct);')
check('typed past divergence', cache.lookup('var order = await _orders.Zzz'), undefined)
check('fully consumed', cache.lookup('var order = await _orders.GetAsync(id, ct);'), undefined)
check('unrelated prefix', cache.lookup('something else'), undefined)

check(
  'strips control tokens',
  cleanCompletion('GetAsync(id, ct);<|endoftext|>trailing', '', false),
  'GetAsync(id, ct);'
)
check(
  'single line cut',
  cleanCompletion('GetAsync(id, ct);\nreturn Ok(order);', '', true),
  'GetAsync(id, ct);'
)
check(
  'keeps multi line when allowed',
  cleanCompletion('GetAsync(id, ct);\nreturn Ok(order);', '', false),
  'GetAsync(id, ct);\nreturn Ok(order);'
)
check(
  'drops duplicated closing brace',
  cleanCompletion('Ok(order);\n}', '\n}\n}', false),
  'Ok(order);'
)
check('rejects whitespace only', cleanCompletion('   \n  ', '', false), undefined)
check('rejects empty', cleanCompletion('', '', false), undefined)

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
