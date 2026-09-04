describe('customers', () => {
  it('lists', () => {
    cy.visit('/customers');
    cy.get('.table tr').should('have.length', 3);
    cy.get('#search').type('acme');
    cy.contains('Acme');
  });
});
