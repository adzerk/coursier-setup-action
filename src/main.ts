import * as cli from '@actions/exec'
import * as core from '@actions/core'
import * as os from 'os'
import * as path from 'path'
import * as tc from '@actions/tool-cache'

const validArchitectures = Object.freeze(['x86_64', 'aarch6'])

const csVersion = core.getInput('version') || '2.1.0-M7-39-gb8f3d7532'
const architecture = core.getInput('architecture') || validArchitectures[0]

const coursierVersionSpec = csVersion

function isValidArchitecture(arch: string): Boolean {
  return validArchitectures.includes(arch)
}

async function execOutput(cmd: string, ...args: string[]): Promise<string> {
  let output = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      },
    },
  }
  await cli.exec(cmd, args.filter(Boolean), options)
  return output.trim()
}

async function downloadCoursier(): Promise<string> {
  const baseUrl = `https://github.com/coursier/coursier/releases/download/v${csVersion}/cs-${architecture}`
  let csBinary = ''
  switch (process.platform) {
    case 'linux': {
      const guid = await tc.downloadTool(`${baseUrl}-pc-linux.gz`)
      const arc = `${guid}.gz`
      await cli.exec('mv', [guid, arc])
      csBinary = arc
      break
    }
    case 'darwin': {
      const guid = await tc.downloadTool(`${baseUrl}-apple-darwin.gz`)
      const arc = `${guid}.gz`
      await cli.exec('mv', [guid, arc])
      csBinary = arc
      break
    }
    case 'win32': {
      const guid = await tc.downloadTool(`${baseUrl}-pc-win32.zip`)
      const arc = `${guid}.zip`
      await cli.exec('mv', [guid, arc])
      csBinary = arc
      break
    }
    default:
      core.setFailed(`Unknown process.platform: ${process.platform}`)
  }
  if (!csBinary) core.setFailed(`Couldn't download Coursier`)
  if (csBinary.endsWith('.gz')) {
    await cli.exec('gzip', ['-d', csBinary])
    csBinary = csBinary.slice(0, csBinary.length - '.gz'.length)
  }
  if (csBinary.endsWith('.zip')) {
    const destDir = csBinary.slice(0, csBinary.length - '.zip'.length)
    await cli.exec('unzip', ['-j', csBinary, `cs-${architecture}-pc-win32.exe`, '-d', destDir])
    csBinary = `${destDir}\\cs-${architecture}-pc-win32.exe`
  }
  await cli.exec('chmod', ['+x', csBinary])
  return csBinary
}

async function cs(...args: string[]): Promise<string> {
  const previous = tc.find('cs', coursierVersionSpec)
  if (previous) {
    core.addPath(previous)
  } else {
    const csBinary = await downloadCoursier()
    const binaryName = process.platform === 'win32' ? 'cs.exe' : 'cs'
    const csCached = await tc.cacheFile(csBinary, binaryName, 'cs', csVersion)
    core.addPath(csCached)
  }
  return execOutput('cs', ...args)
}

async function run(): Promise<void> {
  try {
    if (!isValidArchitecture(architecture)) {
      core.setFailed(
        `Invalid architecture specified. Valid options are: ${validArchitectures.join(', ')}`,
      )
      return
    }

    await core.group('Install Coursier', async () => {
      await cs('--help')
      core.setOutput('cs-version', csVersion)
    })

    await core.group('Install JVM', async () => {
      const jvmInput = core.getInput('jvm')
      const jvmArg = jvmInput ? ['--jvm', jvmInput] : []
      if (!jvmInput && process.env.JAVA_HOME) {
        core.info(`skipping, JVM is already installed in ${process.env.JAVA_HOME}`)
      } else {
        await cs('java', ...jvmArg, '-version')
        const csJavaHome = await cs('java-home', ...jvmArg)
        core.exportVariable('JAVA_HOME', csJavaHome)
        core.addPath(path.join(csJavaHome, 'bin'))
      }
    })

    await core.group('Install Apps', async () => {
      const value = core.getInput('apps').trim()
      const apps: string[] = value.split(' ')
      if (value && apps.length) {
        const coursierBinDir = path.join(os.homedir(), 'cs', 'bin')
        core.exportVariable('COURSIER_BIN_DIR', coursierBinDir)
        core.addPath(coursierBinDir)
        await cs('install', '--contrib', ...apps)
      }
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    core.setFailed(msg)
  }
}

run()
