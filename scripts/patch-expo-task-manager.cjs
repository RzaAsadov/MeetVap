const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const androidFilePath = path.resolve(
  __dirname,
  '../node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskManagerUtils.java',
);
const taskManagerVersion = require('../node_modules/expo-task-manager/package.json').version;
const androidAarPath = path.resolve(
  __dirname,
  `../node_modules/expo-task-manager/local-maven-repo/host/exp/exponent/expo.modules.taskmanager/${taskManagerVersion}/expo.modules.taskmanager-${taskManagerVersion}.aar`,
);

if (fs.existsSync(androidFilePath)) {
  const source = fs.readFileSync(androidFilePath, 'utf8');
  const patched = source
    .replace(
      'if (Build.VERSION.SDK_INT < 28) {',
      'if (Build.VERSION.SDK_INT <= 28) {',
    )
    .replace(
      /jobBuilder\.setMinimumLatency\((?:0|1)\)/,
      'jobBuilder.setMinimumLatency(1000)',
    )
    .replace(
      '.setOverrideDeadline(DEFAULT_OVERRIDE_DEADLINE);',
      '.setOverrideDeadline(DEFAULT_OVERRIDE_DEADLINE)\n' +
        '        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);',
    )
    .replace(
      /catch \(IllegalStateException e\)/g,
      'catch (IllegalStateException | IllegalArgumentException e)',
    );

  if (patched !== source) {
    fs.writeFileSync(androidFilePath, patched);
  }
}

if (!fs.existsSync(androidAarPath)) {
  process.exit(0);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'meetvap-task-manager-'));
const classesJarPath = path.join(temporaryDirectory, 'classes.jar');
const classPath = path.join(temporaryDirectory, 'expo/modules/taskManager/TaskManagerUtils.class');

function runJar(args) {
  const result = spawnSync('jar', args, {
    cwd: temporaryDirectory,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `jar ${args.join(' ')} failed`);
  }
}

try {
  runJar(['xf', androidAarPath, 'classes.jar']);
  runJar(['xf', classesJarPath, 'expo/modules/taskManager/TaskManagerUtils.class']);

  const classBytes = fs.readFileSync(classPath);
  const originalCondition = Buffer.from([0x10, 0x1c, 0xa2]);
  const compatibleCondition = Buffer.from([0x10, 0x1d, 0xa2]);
  const originalOffset = classBytes.indexOf(originalCondition);
  const compatibleOffset = classBytes.indexOf(compatibleCondition);

  if (originalOffset >= 0) {
    classBytes[originalOffset + 1] = 0x1d;
    fs.writeFileSync(classPath, classBytes);
    runJar(['uf', classesJarPath, '-C', temporaryDirectory, 'expo/modules/taskManager/TaskManagerUtils.class']);
    runJar(['uf', androidAarPath, '-C', temporaryDirectory, 'classes.jar']);
    console.log('Patched expo-task-manager packaged AAR for Android API 28 JobInfo compatibility.');
  } else if (compatibleOffset < 0) {
    throw new Error('Unable to locate the expo-task-manager Android API 28 SDK check in the packaged AAR.');
  }
} finally {
  fs.rmSync(temporaryDirectory, { force: true, recursive: true });
}
