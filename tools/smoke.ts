import { CompletionCache } from '../src/cache'
import { cleanCompletion, dropIncompleteLine, suffixStop } from '../src/postprocess'
import { firstSignatureLine, formatBlock } from '../src/blockFormat'

let failures = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`ok   ${name}`)
    return
  }
  failures++
  console.log(`FAIL ${name}`)
  console.log(`  expected ${JSON.stringify(expected)}`)
  console.log(`  actual   ${JSON.stringify(actual)}`)
}

const cache = new CompletionCache()
cache.store('var order = await _orders.', 'GetAsync(id, ct);', 'c1')

check('exact hit', cache.lookup('var order = await _orders.'), { text: 'GetAsync(id, ct);', origin: 'c1' })
check('typed through keeps origin', cache.lookup('var order = await _orders.Get'), {
  text: 'Async(id, ct);',
  origin: 'c1'
})
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
check('drops duplicated closing brace', cleanCompletion('Ok(order);\n}', '\n}\n}', false), 'Ok(order);')
check('rejects whitespace only', cleanCompletion('   \n  ', '', false), undefined)
check('rejects empty', cleanCompletion('', '', false), undefined)

check('suffix stop takes first non blank line', suffixStop('\n}'), '\n}')
check('suffix stop keeps indentation', suffixStop(';\n    }\n}'), '\n    }')
check('suffix stop skips blank lines', suffixStop('\n\n\napp.Run();'), '\napp.Run();')
check('suffix stop normalizes crlf', suffixStop('\r\n    }\r\n}'), '\n    }')
check('suffix stop ignores current line remainder', suffixStop(')\n'), undefined)
check('suffix stop empty suffix', suffixStop(''), undefined)

check('drop incomplete line', dropIncompleteLine('a\nb\npublic int Mod(int a'), 'a\nb')
check('drop incomplete line keeps single line', dropIncompleteLine('.WithName("GetApp'), '.WithName("GetApp')

check(
  'runaway from real ollama output stops at suffix',
  cleanCompletion(
    'a+b;\n}\n \npublic int Sub(int a, int b)\n{\n    return a-b;\n}\n \npublic int Mod(int a, int b',
    '\n}',
    false,
    true
  ),
  'a+b;'
)
check(
  'truncated without suffix match drops incomplete line',
  cleanCompletion('a\nb\npublic int Mod(int a', '', false, true),
  'a\nb'
)
check(
  'inner block brace survives deeper indentation',
  cleanCompletion('if (x)\n        {\n            y();\n        }', '\n    }\n}', false),
  'if (x)\n        {\n            y();\n        }'
)
check('current line overlap trimmed', cleanCompletion('a, b)', ')\n', false), 'a, b')
check(
  'truncated single line is kept for partial accept',
  cleanCompletion('.WithName("GetApp', '', false, true),
  '.WithName("GetApp'
)
check(
  'stopped at suffix leaves clean output',
  cleanCompletion('a+b;', '\n}', false, false),
  'a+b;'
)

check(
  'hover fenced block',
  firstSignatureLine('```csharp\nTask<Order> IOrderService.GetAsync(Guid id)\n```\nSummary here'),
  'Task<Order> IOrderService.GetAsync(Guid id)'
)
check('hover plain text', firstSignatureLine('(local variable) int count'), '(local variable) int count')
check('hover empty', firstSignatureLine('```\n\n```'), undefined)

check(
  'block uses language comment prefix',
  formatBlock(['int count'], 'python', 1000),
  '# --- context ---\n# int count\n# --- current file ---\n'
)
check(
  'block dedupes',
  formatBlock(['int count', 'int count'], 'csharp', 1000),
  '// --- context ---\n// int count\n// --- current file ---\n'
)
check(
  'block drops oldest to fit budget',
  formatBlock(['aaaaaaaaaa', 'bb'], 'csharp', 60),
  '// --- context ---\n// bb\n// --- current file ---\n'
)
check('block empty when nothing fits', formatBlock(['aaaaaaaaaaaaaaaaaaaa'], 'csharp', 10), '')
check('block empty without signatures', formatBlock([], 'csharp', 1000), '')

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
