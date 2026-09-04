import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { groupScenarios, ScenarioTree } from './ScenarioTree';
import { scenarios } from '../../mocks/data';

describe('groupScenarios', () => {
  it('groups by module then feature, sorted, and keeps scenario order', () => {
    const groups = groupScenarios(scenarios);
    expect(groups.map((g) => g.module)).toEqual([
      'auth',
      'cart',
      'hybrid',
      'inventory',
      'posts-api',
    ]);
    const auth = groups[0]!;
    expect(auth.features).toHaveLength(1);
    expect(auth.features[0]!.scenarios.map((s) => s.scenarioName)).toEqual([
      'Successful login',
      'Failed login – locked_out_user',
      'Failed login – wrong password',
    ]);
  });

  it('puts scenarios without a module under "(no module)"', () => {
    const groups = groupScenarios([{ ...scenarios[0]!, module: null }]);
    expect(groups[0]!.module).toBe('(no module)');
  });
});

describe('ScenarioTree', () => {
  it('renders module sections with badges for flaky, healed, visual and jira links', () => {
    render(
      <MemoryRouter>
        <ScenarioTree runId="run-2" scenarios={scenarios} />
      </MemoryRouter>,
    );
    const inventory = screen.getByTestId('module-inventory');
    expect(within(inventory).getByText('flaky')).toBeInTheDocument();
    expect(within(inventory).getByText('healed ×1')).toBeInTheDocument();
    expect(within(inventory).getByText('visual')).toBeInTheDocument();
    const auth = screen.getByTestId('module-auth');
    expect(within(auth).getByText('DEMO-12')).toBeInTheDocument();
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
  });
});
