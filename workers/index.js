const FramedStream = require('framed-stream')
const goodbye = require('graceful-goodbye')
const path = require('bare-path')
const dir = require('bare-storage')
const { isBareKit } = require('which-runtime')

const WorkerTask = require('./worker-task.js')

// BareKit workers omit the executable and entrypoint from Bare.argv.
const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

async function main() {
  const storage = path.join(argv(0) || dir.persistent(), 'game')
  const bootstrapKey = argv(1) || undefined
  const network = argv(2) !== 'false'
  const pipe = new FramedStream(Bare.IPC)
  pipe.pause()

  const workerTask = new WorkerTask(pipe, storage, { bootstrapKey, network })
  goodbye(() => workerTask.close())

  await workerTask.ready()
  pipe.resume()
}

main().catch((err) => {
  console.error(err)
  Bare.exit(1)
})
