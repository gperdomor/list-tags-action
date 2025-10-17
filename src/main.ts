import * as core from '@actions/core';
import { sort } from 'semver';
import { DockerHubClient } from './dockerhub-client.js';
import { ActionInputs, ActionOutputs, DockerHubTag } from './types.js';

function getInputs(): ActionInputs {
  return {
    repository: core.getInput('repository', { required: true }),
    username: core.getInput('username'),
    password: core.getInput('password'),
    maxResults: parseInt(core.getInput('max-results') || '200', 10),
    name: core.getInput('name'),
    ordering: core.getInput('ordering'),
    filter: core.getInput('filter'),
  };
}

/**
 * Filter tags based on regex pattern
 */
function filterTags(tags: string[], pattern: string): string[] {
  try {
    const regex = new RegExp(pattern);
    return tags.filter((tag) => regex.test(tag));
  } catch (error) {
    core.warning(`Invalid filter pattern: ${error}`);
    return tags;
  }
}

/**
 * Process and set outputs
 */
function setOutputs(results: DockerHubTag[], filteredTags: string[]): void {
  const outputs: ActionOutputs = {
    tags: filteredTags,
    latestTag: filteredTags?.at(-1) || '',
    tagCount: filteredTags.length,
  };

  core.setOutput('tags', JSON.stringify(outputs.tags));
  core.setOutput('latest-tag', outputs.latestTag);
  core.setOutput('tag-count', outputs.tagCount);

  core.info(`✓ Found ${outputs.tagCount} tags`);
  if (outputs.tagCount > 0) {
    core.info('');
    core.info(`Latest tag: ${outputs.latestTag}`);
    core.info('');
    core.info('All tags:');
    const displayTags = outputs.tags.slice(0, 20);
    displayTags.forEach((tag) => core.info(`  - ${tag}`));
    if (outputs.tagCount > 20) {
      core.info(`... and ${outputs.tagCount - 20} more`);
    }
  }
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const inputs = getInputs();

    core.info(`Fetching tags for Docker Hub repository: ${inputs.repository}`);

    const client = new DockerHubClient();

    // Authenticate if credentials provided
    if (inputs.username && inputs.password) {
      await client.authenticate(inputs.username, inputs.password);
    }

    // Fetch tags
    const results = await client.fetchTags(inputs);

    // Extract tag names
    const allTags = results.map((tag) => tag.name).filter((name) => name);
    const uniqueTags = Array.from(new Set(allTags));

    // Apply filter if provided
    let filteredTags = uniqueTags;
    if (inputs.filter) {
      core.info(`Applying filter: ${inputs.filter}`);
      filteredTags = filterTags(uniqueTags, inputs.filter);
    }

    // Sort tags using semver if possible, fallback to lexicographic sort
    try {
      filteredTags = sort(filteredTags);
    } catch (error) {
      core.debug(`Semver sort failed, using lexicographic sort: ${error}`);
      filteredTags = filteredTags.sort();
    }

    // Set outputs
    setOutputs(results, filteredTags);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`❌ Error: ${error.message}`);
    } else {
      core.setFailed(`❌ Error: ${error}`);
    }
  }
}
