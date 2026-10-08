import * as p_ from 'pareto-core/command'
import * as p_ci from 'pareto-core/command_interface'

import * as d_main from "pareto-application-api/schemas/main/schema"

export type Tool_Kind = 'transformer' | 'refiner' | 'serializer' | 'deserializer'

export type Tool_Help = {
    name: string
    kind: Tool_Kind
    parameters: boolean
    format?: string
    interfaces: readonly {
        role: string
        schema: string
        type: string
    }[]
}

export function interface_schema_url(relativePath: string, entryPoint: string): string {
    return new URL(relativePath, entryPoint).href
}

/** Called by generated entry points before invoking a tool or reading its streams. */
export function configure_main_help(help: Tool_Help): void {
    if (!process.argv.slice(2).includes('--help') && !process.argv.slice(2).includes('-h')) return
    const lines = [
        `${help.name} - ${help.kind}${help.parameters ? ' with parameters' : ''}`,
        '',
    ]
    const inputType = help.interfaces.find(item => item.role === 'input')?.type
    const outputType = help.interfaces.find(item => item.role === 'output')?.type
    const input = inputType === undefined ? 'the input schema' : `"${inputType}"`
    const output = outputType === undefined ? 'the output schema' : `"${outputType}"`
    const format = help.format ? `the .${help.format} format` : 'its external text format'
    switch (help.kind) {
        case 'serializer':
            lines.push(`This tool serializes instances of ${input} from ASTN notation to ${format}.`)
            break
        case 'deserializer':
            lines.push(`This tool deserializes ${format} into instances of ${output} in ASTN notation.`)
            break
        case 'transformer':
            lines.push(`This tool transforms instances of ${input} into instances of ${output}.`,
                'Both datasets use ASTN notation; their schemas are linked below.')
            break
        case 'refiner':
            lines.push(`This tool refines instances of ${input} into instances of ${output}.`,
                'It checks the input and either produces the result or reports a structured refinement error.')
            if (help.parameters) lines.push('This refiner also accepts a separate configuration/parameter dataset.')
            break
    }
    const refiner = help.kind === 'refiner' || help.kind === 'deserializer'
    lines.push('', 'USAGE',
        `  ${help.name} < input ${help.parameters ? '4< parameters.lna ' : ''}> output${refiner ? ' 3> errors.lna' : ''}`,
        '',
        'Use the command you invoked for this tool (or node /path/to/index.generated.js).',
        'The | operator connects stdout to the next tool; < and > read/write files.',
        'Diagnostics go to stderr, keeping them out of the data pipeline.')
    lines.push('', `A ${help.kind} is a tool that follows the Pareto workflow.`,
        '',
        'THE PARETO WORKFLOW',
        'Unix pipes connect programs by passing text. Pareto tools use the same',
        'mechanism to pass schema-defined datasets in ASTN (Abstract Syntax Tree',
        'Notation), rather than asking each tool to interpret ad-hoc text.',
        'These ASTN files contain structured data conforming to a schema, which',
        'defines the permitted properties, options, and value types.',
        '',
        'Start by deserializing an external format, or supply an existing sealed',
        'ASTN dataset. Transform or refine it, then serialize it into the format',
        'needed by the next system:',
        '',
        '  deserializer | transformer | refiner | serializer',
        '',
        'Connect tools whose interface schemas agree; ASTN is the notation,',
        'not a guarantee that any two datasets have compatible structures.',
        '',
        'HOW TO USE THIS TOOL',
        'This tool works with streams, not filenames. It reads standard input',
        'and writes standard output, so you can connect it directly to another',
        'tool without creating intermediate files. Shell redirection lets you',
        'use files just as easily. The caller chooses where the data comes from',
        'and where it goes; the tool concentrates on processing that data.',
        'Stream-based does not mean incremental: this tool reads all input first.',
        '',
        'INPUT AND OUTPUT',
        'stdin: UTF-8 input, read completely before processing.')
    lines.push(help.kind === 'deserializer'
        ? 'Input is the external text format parsed by this deserializer.'
        : 'Input is an ASTN instance of the input schema.')
    if (help.parameters) lines.push('fd 4: parameters, as a UTF-8 ASTN instance of the parameters schema.')
    lines.push(help.kind === 'serializer'
        ? 'stdout: serialized output in the format produced by this serializer.'
        : 'stdout: output as a UTF-8 ASTN instance of the output schema.')
    lines.push('stderr: human-readable diagnostics.')
    if (refiner) {
        lines.push('fd 3: structured refinement errors in ASTN notation when opened by the caller.',
            'Exit codes: 0 success; 1 implementation/I/O error; 2 invalid input; 3 refinement error.')
    } else {
        lines.push('Exit codes: 0 success; 1 failure.')
    }
    lines.push('', 'INTERFACE SCHEMAS', 'Sealed interface schemas included in this package:')
    for (const item of help.interfaces) {
        lines.push(`  ${item.role} (entry type: "${item.type}")`, `    ${item.schema}`)
    }
    lines.push('', 'These schemas describe the data this tool accepts and produces, including',
        'property and option documentation where provided. They are shipped with',
        'the package, so you can inspect the contract and even generate an API',
        'without the source project.',
        'file: links are clickable in terminals that support local file URLs.',
        '',
        'Show this help with --help or -h; neither reads input nor runs the tool.')
    process.stdout.write(lines.join('\n') + '\n')
    process.exit(0)
}

function generic_help(kind: Tool_Kind): void {
    configure_main_help({ name: process.argv[1] ?? 'tool', kind, parameters: false, interfaces: [] })
}

/**
 * Runs a program main command.
 *
 * Contract for calling tools:
 * - **arguments**: all command line arguments after `node` and the script name.
 * - **stdin / stdout / stderr**: used as the command itself decides.
 * - **exit code**: the `exit code` returned by the command when it completes.
 *
 * @param get_main factory returning the command to execute
 */
export const run_main_command = (
    get_main: () => p_ci.Command_Interface<d_main.Error, d_main.Parameters>,
): undefined => {
    get_main().execute(
        {
            'arguments': p_.literal.list(process.argv.slice(2))
        },
        ($) => $,
    ).__start(
        () => {
        },
        ($) => {
            process.exitCode = $['exit code']
        }
    )
}

import * as p_s from 'pareto-core/schema'
import * as p_r from 'pareto-core/refiner'
import { createReadStream, fstatSync, writeSync } from 'node:fs'


/**
 * A transformer: reads the whole of stdin and produces lines of output.
 * Input is the stdin text as a list of UTF-16 character codes; output is a
 * list of lines. The error type is a plain message.
 */
export type Main_Transformer = p_r.Refiner<
    p_s.List<string>,
    string,
    p_s.List<number>
>

/**
 * Runs a {@link Main_Transformer} as a process.
 *
 * Contract for calling tools:
 * - **stdin**: read completely (UTF-8) before the transformer is invoked.
 * - **stdout**: on success, each output line followed by a newline.
 * - **stderr**: on failure, the error message.
 * - **exit code**: `0` on success, `1` on failure.
 *
 * @param transformer the transformer to run
 */
export function run_main_transformer(
    transformer: Main_Transformer
) {
    generic_help('transformer')
    const stdin = process.stdin
    let data: number[] = []
    stdin.setEncoding('utf8')

    stdin.on('data', (chunk: string) => {
        for (let i = 0; i < chunk.length; i++) {
            data.push(chunk.charCodeAt(i))
        }
    })

    stdin.on('end', () => {
        transformer(
            p_.literal.list(data),
            ($) => {
                console.error($)
                process.exitCode = 1
                process.exit(1)
            }
        ).__get_raw().forEach(
            ($) => console.log($)
        )
    })

    stdin.resume()
}


/**
 * Errors a {@link Main_Refiner} can produce:
 * - `invalid input`: the input could not be parsed or failed validation
 *   (the caller supplied bad data).
 * - `refinement error`: the input was valid, but refining it failed. The error
 *   is data of the refiner's error schema.
 */
export type Refinement_Error<Error extends p_s.Value> =
    | ['invalid input', string]
    | ['refinement error', Error]

/**
 * A refiner: like a {@link Main_Transformer}, but it reports
 * {@link Refinement_Error}s so that calling tools can tell invalid input
 * apart from refinement errors.
 */
export type Main_Refiner<Error extends p_s.Value> = p_r.Refiner<
    p_s.List<string>,
    Refinement_Error<Error>,
    p_s.List<number>
>

/**
 * How {@link run_main_refiner} reports a refinement error:
 * - `serialize` (plumbing): the error as data (for example Liana), written to
 *   fd 3 for calling tools.
 * - `describe` (porcelain): a human-readable message, written to stderr.
 *   Typically the serializer of the error schema.
 */
export type Refinement_Error_Reporting<Error extends p_s.Value> = {
    'serialize': ($: Error) => p_s.List<string>
    'describe': ($: Error) => string
}

/**
 * File descriptor on which refinement errors are reported.
 * The calling tool can open it, e.g. `node main.js 3>errors.jsonl`, or via
 * `spawn(..., { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })`.
 * If fd 3 is not open, the error falls back to stderr.
 */
export const REFINEMENT_ERROR_FD = 3

/**
 * Exit code of an implementation error: a bug in the tool. It is the exit code of an uncaught exception
 * in Node.js and of an unreachable code path (see `unreachable_code_path` in pareto-core).
 * There is deliberately no catch-all that maps exceptions to it.
 */
export const EXIT_CODE_IMPLEMENTATION_ERROR = 1

/** Exit code used by {@link run_main_refiner} when the input is invalid. */
export const EXIT_CODE_INVALID_INPUT = 2

/** Exit code used by {@link run_main_refiner} when refinement fails. */
export const EXIT_CODE_REFINEMENT_ERROR = 3


/**
 * Runs a {@link Main_Refiner} as a process.
 *
 * Contract for calling tools:
 * - **stdin**: read completely (UTF-8) before the refiner is invoked.
 * - **stdout**: on success, each output line followed by a newline.
 * - **stderr**: for invalid input, `Invalid input: <message>`; for a
 *   refinement error, `Refinement error: <describe(error)>`.
 * - **fd 3** ({@link REFINEMENT_ERROR_FD}): for a refinement error, each line
 *   of `serialize(error)` followed by a newline. Nothing is written if the
 *   caller did not open fd 3.
 * - **exit code**: `0` on success, {@link EXIT_CODE_INVALID_INPUT} (`2`) for
 *   invalid input, {@link EXIT_CODE_REFINEMENT_ERROR} (`3`) for a refinement
 *   error, {@link EXIT_CODE_IMPLEMENTATION_ERROR} (`1`) for an implementation
 *   error (a bug in the refiner).
 *
 * @example
 * ```sh
 * node main.js < input.txt > output.txt 3> refinement-error.lna
 * ```
 * @example
 * ```ts
 * const child = spawn('node', ['main.js'], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
 * child.stdio[3]!.on('data', (chunk) => { ... }) // the refinement error as data
 * ```
 *
 * @param refiner the refiner to run
 * @param refinement_error how a refinement error is written to fd 3 and stderr
 */
export function run_main_refiner<Error extends p_s.Value>(
    refiner: Main_Refiner<Error>,
    refinement_error: Refinement_Error_Reporting<Error>,
) {
    generic_help('refiner')
    const stdin = process.stdin
    let data: number[] = []
    stdin.setEncoding('utf8')

    stdin.on('data', (chunk: string) => {
        for (let i = 0; i < chunk.length; i++) {
            data.push(chunk.charCodeAt(i))
        }
    })

    stdin.on('end', () => {
        refiner(
            p_.literal.list(data),
            ($) => {
                switch ($[0]) {
                    case 'invalid input':
                        process.stderr.write(`Invalid input: ${$[1]}\n`)
                        process.exit(EXIT_CODE_INVALID_INPUT)
                    case 'refinement error': {
                        const lines = refinement_error.serialize($[1]).__get_raw()
                        const message = refinement_error.describe($[1])
                        try {
                            writeSync(REFINEMENT_ERROR_FD, lines.map((line) => line + '\n').join(''))
                        } catch (e) {
                            // fd 3 is not open: the caller only wants the message
                        }
                        process.stderr.write(`Refinement error: ${message}\n`)
                        process.exit(EXIT_CODE_REFINEMENT_ERROR)
                    }
                }
            }
        ).__get_raw().forEach(
            ($) => console.log($)
        )
    })

    stdin.resume()
}

/** A parameterized refiner receives source text and parameter text separately. */
export type Main_Refiner_With_Parameters<Error extends p_s.Value> = (
    source: p_s.List<number>,
    abort: ($: Refinement_Error<Error>) => never,
    parameters: p_s.List<number>,
) => p_s.List<string>

export const PARAMETERS_FD = 4

/**
 * Like run_main_refiner, with sealed parameters on fd 4. Both input streams
 * are read concurrently before invoking the refiner. Missing/unreadable input
 * streams are invalid input (exit 2); fd 3 remains the refinement-error output.
 */
export function run_main_refiner_with_parameters<Error extends p_s.Value>(
    refiner: Main_Refiner_With_Parameters<Error>,
    refinement_error: Refinement_Error_Reporting<Error>,
) {
    configure_main_help({ name: process.argv[1] ?? 'tool', kind: 'refiner', parameters: true, interfaces: [] })
    const read = (stream: NodeJS.ReadableStream, label: string): Promise<p_s.List<number>> =>
        new Promise((resolve, reject) => {
            const data: number[] = []
            stream.setEncoding('utf8')
            stream.on('data', (chunk: string) => {
                for (let i = 0; i < chunk.length; i++) {
                    data.push(chunk.charCodeAt(i))
                }
            })
            stream.on('end', () => resolve(p_.literal.list(data)))
            stream.on('error', (error: globalThis.Error) => reject(new globalThis.Error(`${label}: ${error.message}`)))
        })
    Promise.all([
        read(process.stdin, 'source'),
        read(createReadStream('', { fd: PARAMETERS_FD, autoClose: false }), 'parameters'),
    ]).then(([source, parameters]) => {
        refiner(source, ($) => {
            switch ($[0]) {
                case 'invalid input':
                    process.stderr.write(`Invalid input: ${$[1]}\n`)
                    process.exit(EXIT_CODE_INVALID_INPUT)
                case 'refinement error': {
                    const lines = refinement_error.serialize($[1]).__get_raw()
                    try {
                        const descriptor = fstatSync(REFINEMENT_ERROR_FD)
                        if (descriptor.isFile() || descriptor.isFIFO() || descriptor.isSocket()) {
                            writeSync(REFINEMENT_ERROR_FD, lines.map((line) => line + '\n').join(''))
                        }
                    } catch (error) {
                        if (!(error instanceof globalThis.Error) || !('code' in error) || error.code !== 'EBADF') {
                            throw error
                        }
                    }
                    process.stderr.write(`Refinement error: ${refinement_error.describe($[1])}\n`)
                    process.exit(EXIT_CODE_REFINEMENT_ERROR)
                }
            }
        }, parameters).__get_raw().forEach(($) => console.log($))
    }, (error: globalThis.Error) => {
        process.stderr.write(`Invalid input: ${error.message}\n`)
        process.exit(EXIT_CODE_INVALID_INPUT)
    })
}

/**
 * A serializer: reads the whole of stdin and produces a single string.
 * Input is the stdin text as a list of UTF-16 character codes. The error type
 * is a plain message.
 */
export type Main_Serializer = p_r.Refiner<
    string,
    string,
    p_s.List<number>
>

/**
 * Runs a {@link Main_Serializer} as a process.
 *
 * Contract for calling tools:
 * - **stdin**: read completely (UTF-8) before the serializer is invoked.
 * - **stdout**: on success, the serialized string followed by a newline.
 * - **stderr**: on failure, the error message.
 * - **exit code**: `0` on success, `1` on failure.
 *
 * @param serializer the serializer to run
 */
export function run_main_serializer(
    serializer: Main_Serializer
) {
    generic_help('serializer')
    const stdin = process.stdin
    let data: number[] = []
    stdin.setEncoding('utf8')

    stdin.on('data', (chunk: string) => {
        for (let i = 0; i < chunk.length; i++) {
            data.push(chunk.charCodeAt(i))
        }
    })

    stdin.on('end', () => {
        console.log(serializer(
            p_.literal.list(data),
            ($) => {
                console.error($)
                process.exitCode = 1
                process.exit(1)
            }
        ))
    })

    stdin.resume()
}