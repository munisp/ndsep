import 'react-native';
import React from 'react';
import App from '../src/App';
import { render } from '@testing-library/react-native';

describe('App', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<App />);
    // App should render the navigation container
    expect(getByText).toBeDefined();
  });
});
