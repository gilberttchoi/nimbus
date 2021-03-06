import chalk from 'chalk';
import execa from 'execa';
// @ts-ignore Not typed
import editJsonFile from 'edit-json-file';
import { prompt } from 'enquirer';
import { Path } from '@beemo/core';
import { NimbusPackage } from '@airbnb/nimbus-common';
import { BANNER } from '../constants';
import installDeps from '../helpers/installDeps';

interface SetupPrompt {
  drivers: string[];
  libs: string[];
  type: string;
  node: boolean;
  next: boolean;
  scaffold: boolean;
  scripts: boolean;
  yarn: boolean;
}

const pkgPath = Path.resolve('package.json').path();

function addNimbusToPackage(response: SetupPrompt) {
  const pkg = editJsonFile(pkgPath);
  const nimbus: Partial<NimbusPackage['nimbus']> = {
    drivers: response.drivers,
    settings: {},
  };

  if (response.libs.includes('graphql')) {
    nimbus.settings!.graphql = true;
  }

  if (response.type === 'lib' || response.type === 'monolib') {
    nimbus.settings!.library = true;
  }

  if (response.next) {
    nimbus.settings!.next = true;
  }

  if (response.node) {
    nimbus.settings!.node = true;
  }

  if (response.libs.includes('react')) {
    nimbus.settings!.react = true;
  }

  pkg.set('nimbus', nimbus);
  pkg.save();
}

function addScriptsToPackage(response: SetupPrompt) {
  const { drivers } = response;
  const pkg = editJsonFile(pkgPath);
  const client = response.yarn ? 'yarn' : 'npm';
  const monorepo = response.type === 'monolib';
  const scripts = pkg.get('scripts') || {};

  scripts.prepare = 'nimbus create-config --silent';

  if (drivers.includes('babel')) {
    if (monorepo) {
      scripts.build = 'nimbus babel --workspaces=* && nimbus babel --esm --workspaces=*';
    } else {
      scripts.build = 'nimbus babel && nimbus babel --esm';
    }
  }

  if (drivers.includes('eslint')) {
    scripts.lint = 'nimbus eslint';
    scripts.posttest = `${client} run lint`;
  }

  if (drivers.includes('jest')) {
    scripts.jest = 'NODE_ENV=test TZ=UTC nimbus jest';
    scripts['jest:coverage'] = `${client} run jest -- --coverage`;
    scripts.test = `${client} run jest:coverage`;
  }

  if (drivers.includes('prettier')) {
    scripts.prettier = 'nimbus prettier';
  }

  if (drivers.includes('typescript')) {
    if (monorepo) {
      scripts.type = 'nimbus typescript --build --reference-workspaces';
      scripts.prebuild = 'yarn run type';
    } else {
      scripts.type = 'nimbus typescript --noEmit';
      scripts.postbuild = 'nimbus typescript --emitDeclarationOnly';
    }

    scripts.pretest = `${client} run type`;
  }

  if (drivers.includes('webpack')) {
    scripts.build = 'NODE_ENV=production nimbus webpack';
    scripts.start = 'nimbus create-config webpack --silent && nimbus-webpack-server';

    delete scripts.prebuild;
    delete scripts.postbuild;
  }

  pkg.set('scripts', scripts);
  pkg.save();
}

export async function setup() {
  console.log(BANNER);
  console.log(`${chalk.cyan('[1/6]')} Setting up Nimbus`);

  const response = await prompt<SetupPrompt>([
    {
      type: 'multiselect',
      name: 'drivers',
      message: 'Which developer tools are you going to use?',
      choices: [
        { message: 'Babel', name: 'babel' },
        { message: 'ESLint', name: 'eslint' },
        { message: 'Jest', name: 'jest' },
        { message: 'Prettier', name: 'prettier' },
        { message: 'TypeScript', name: 'typescript' },
        { message: 'Webpack', name: 'webpack' },
      ],
    },
    {
      type: 'multiselect',
      name: 'libs',
      message: 'Which libraries are you going to use?',
      choices: [
        { message: 'React', name: 'react' },
        { message: 'GraphQL', name: 'graphql' },
      ],
    },
    {
      type: 'select',
      name: 'type',
      message: 'Which type of project is this?',
      choices: [
        { message: 'Application', name: 'app' },
        { message: 'Library', name: 'lib' },
        { message: 'Library (monorepo)', name: 'monolib' },
      ],
    },
    {
      type: 'confirm',
      name: 'node',
      message: 'Is this a Node.js only project?',
    },
    {
      type: 'confirm',
      name: 'next',
      message: 'Do you want to enable experimental features?',
    },
    {
      type: 'confirm',
      name: 'scaffold',
      message: 'Do you want to scaffold dotfiles?',
    },
    {
      type: 'confirm',
      name: 'scripts',
      message: 'Do you want to define package scripts?',
    },
    {
      type: 'confirm',
      name: 'yarn',
      message: 'Are you using Yarn?',
    },
  ]);

  if (response.drivers.includes('jest') && !response.drivers.includes('babel')) {
    response.drivers.push('babel');
  }

  console.log(`${chalk.cyan('[2/6]')} Updating package settings`);

  addNimbusToPackage(response);

  console.log(`${chalk.cyan('[3/6]')} Installing dependencies`);

  await installDeps(
    ['@airbnb/nimbus', ...response.drivers.map(driver => `@airbnb/config-${driver}`)],
    response.yarn,
    response.type === 'monolib',
  );

  console.log(`${chalk.cyan('[4/6]')} Adding package scripts`);

  if (response.scripts) {
    addScriptsToPackage(response);
  } else {
    console.log(chalk.gray('Not chosen, skipping'));
  }

  console.log(`${chalk.cyan('[5/6]')} Scaffolding dotfiles`);

  if (response.scaffold) {
    await execa('nimbus', ['scaffold', 'project', 'dotfiles'], { preferLocal: true });
  } else {
    console.log(chalk.gray('Not chosen, skipping'));
  }

  console.log(`${chalk.cyan('[6/6]')} Generating config files`);

  await execa('nimbus', ['create-config', '--silent'], { preferLocal: true });
}
